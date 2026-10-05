import { check, id, now, permit, text, type Actor } from "./core.ts";
import { Database, type Store } from "./database.ts";
import type { Identity } from "./iam.ts";
import type { Platform } from "./platform.ts";
import { RECORD_NOTES_INITIALIZE } from "./record-notes-schema.ts";
import {
  recordNoteKinds,
  type RecordNote,
  type RecordNoteTarget,
  type RecordNotesPage,
  type AddRecordNote,
  type VerifyRecordNote,
} from "../shared/record-notes.ts";

type NoteRow = {
  sequence: number;
  id: string;
  kind: RecordNoteTarget["kind"];
  record_id: string;
  body: string;
  author_id: string;
  author_name: string;
  created_at: string;
  verifier_id: string | null;
  verifier_name: string | null;
  verified_at: string | null;
};
const columns =
  "n.sequence,n.id,n.kind,n.record_id,n.body,n.author_id,n.author_name,n.created_at,v.verifier_id,v.verifier_name,v.verified_at";
const join =
  "notes_records n LEFT JOIN notes_verifications v ON v.note_id=n.id AND v.org_id=n.org_id";
const verifierRoles = ["admin", "commercial", "finance", "warranty"];
/** Owns annotations only. Existence, organization and site authority stay with each record owner. */
export class RecordNotes {
  private store: Store;
  constructor(
    private database: Database,
    private identity: Identity,
    private platform: Platform,
    private authorizeRecord: (actor: Actor, target: RecordNoteTarget) => void,
  ) {
    this.store = database.owned("notes");
    this.store.migrate(RECORD_NOTES_INITIALIZE);
  }
  private authority(actor: Actor, target: RecordNoteTarget) {
    actor = this.identity.currentActor(actor);
    permit(actor, [
      "commercial",
      "finance",
      "warehouse",
      "warranty",
      "support",
    ]);
    const security = this.identity.security(actor);
    check(
      !security.passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before accessing notes.",
      403,
    );
    check(
      !security.mfa.required || security.mfa.enabled,
      "MFA_REQUIRED",
      "Complete required MFA enrollment before accessing notes.",
      403,
    );
    check(
      recordNoteKinds.includes(target.kind),
      "VALIDATION",
      "Unknown record kind.",
      400,
    );
    text(target.recordId, "Record ID", 128);
    this.authorizeRecord(actor, target);
    return actor;
  }
  private writeAuthority(actor: Actor, target: RecordNoteTarget) {
    const current = this.authority(actor, target);
    check(
      !this.platform.recoveryHold(),
      "RECOVERY_HOLD",
      "Restored data requires operator review before adding or verifying notes.",
      503,
    );
    return current;
  }
  private view(row: NoteRow): RecordNote {
    return {
      id: row.id,
      kind: row.kind,
      recordId: row.record_id,
      body: row.body,
      visibility: "staff",
      authorId: row.author_id,
      authorName: row.author_name,
      createdAt: row.created_at,
      verification:
        row.verifier_id === null
          ? null
          : {
              verifierId: row.verifier_id,
              verifierName: row.verifier_name!,
              verifiedAt: row.verified_at!,
            },
    };
  }
  private note(actor: Actor, target: RecordNoteTarget, noteId: string) {
    const row = this.store.get<NoteRow>(
      `SELECT ${columns} FROM ${join} WHERE n.org_id=? AND n.kind=? AND n.record_id=? AND n.id=?`,
      actor.orgId,
      target.kind,
      target.recordId,
      text(noteId, "Note ID", 128),
    );
    check(row, "NOT_FOUND", "Note not found.", 404);
    return row;
  }
  list(
    actor: Actor,
    target: RecordNoteTarget,
    after?: string,
  ): RecordNotesPage {
    return this.database.transaction(() => {
      actor = this.authority(actor, target);
      const cursor =
        after === undefined ? null : this.note(actor, target, after).sequence;
      const rows = this.store.all<NoteRow>(
        `SELECT ${columns} FROM ${join} WHERE n.org_id=? AND n.kind=? AND n.record_id=? AND (? IS NULL OR n.sequence<?) ORDER BY n.sequence DESC LIMIT 21`,
        actor.orgId,
        target.kind,
        target.recordId,
        cursor,
        cursor,
      );
      const items = rows.slice(0, 20).map((row) => this.view(row));
      return {
        items,
        next: rows.length > 20 ? items.at(-1)!.id : null,
        canVerify: verifierRoles.includes(actor.role),
      };
    });
  }
  add(actor: Actor, key: string, input: AddRecordNote): RecordNote {
    return this.platform.command(
      actor,
      "notes.add",
      key,
      input,
      () => {
        actor = this.writeAuthority(actor, input);
        text(input.body, "Note", 4000);
      },
      () => {
        const noteId = id();
        this.store.run(
          "INSERT INTO notes_records(id,org_id,kind,record_id,body,author_id,author_name,created_at) VALUES(?,?,?,?,?,?,?,?)",
          noteId,
          actor.orgId,
          input.kind,
          input.recordId,
          text(input.body, "Note", 4000),
          actor.id,
          actor.name,
          now(),
        );
        return this.view(this.note(actor, input, noteId));
      },
    );
  }
  verify(actor: Actor, key: string, input: VerifyRecordNote): RecordNote {
    return this.platform.command(
      actor,
      "notes.verify",
      key,
      input,
      () => {
        actor = this.writeAuthority(actor, input);
        permit(actor, ["commercial", "finance", "warranty"]);
        const note = this.note(actor, input, input.noteId);
        check(
          note.author_id !== actor.id,
          "INDEPENDENT_REVIEW",
          "Another authorized staff member must verify this note.",
          403,
        );
      },
      () => {
        const note = this.note(actor, input, input.noteId);
        check(
          note.verifier_id === null,
          "NOTE_ALREADY_VERIFIED",
          "This note already has an independent verification.",
        );
        this.store.run(
          "INSERT INTO notes_verifications VALUES(?,?,?,?,?)",
          note.id,
          actor.orgId,
          actor.id,
          actor.name,
          now(),
        );
        return this.view(this.note(actor, input, input.noteId));
      },
    );
  }
}
