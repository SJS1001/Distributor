import type { ControlIssue, ControlIssues } from "../shared/reconciliation.ts";
// Totals cover the full scan; only the first 100 details leave the server.
export class IssueCollector {
  private count = 0;
  private items: ControlIssue[] = [];
  add(
    code: string,
    recordId: string,
    expected: bigint | string | null = null,
    actual: bigint | string | null = null,
  ) {
    this.count++;
    if (this.items.length < 100)
      this.items.push({
        code,
        recordId,
        expected: expected === null ? null : String(expected),
        actual: actual === null ? null : String(actual),
      });
  }
  compare(code: string, recordId: string, expected: bigint, actual: bigint) {
    if (expected !== actual) this.add(code, recordId, expected, actual);
  }
  result(): ControlIssues {
    return {
      count: this.count,
      items: this.items,
      truncated: this.count > this.items.length,
    };
  }
}
