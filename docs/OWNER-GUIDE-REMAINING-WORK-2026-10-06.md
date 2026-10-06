# Remaining work and your decisions, in plain language

Written 2026-10-06 for the owner. The detailed, evidence-linked version is [REMAINING-WORK-LEDGER-2026-10-05.md](REMAINING-WORK-LEDGER-2026-10-05.md). Nothing here claims the system is ready for real customers.

## Where things stand

The website, customer portal and staff workspace are built and running on the Canadian pilot at https://dstrbtr.ca with fictional sample data. All automated checks currently pass: 6,060 back-end checks and every browser test suite.

What remains is mostly not programming. It is:

- choices only you can make;
- outside accounts and contracts;
- testing with real devices and people;
- getting the books, policies and data ready for real use.

## Remaining work, in plain terms

1. **Look at it yourself.** Use the site on your own phone and computer and tell us what still feels wrong. Our phone checks used a phone-sized browser window, not an actual iPhone.
2. **Automatic emails.** The system cannot send email yet: no invitations, password help or notices. Today, staff copy an invitation link and send it themselves. We need an email service chosen before we can build this.
3. **Purolator shipping.** The system can talk to Canada Post, DHL and FedEx test services, but not Purolator. Purolator hasn't given us their technical documentation. Until they do, staff book Purolator shipments in Purolator's own tool and type the tracking number into Distributor.
4. **Backups you can trust.** Five days of automatic Fly snapshots are requested, and we take an encrypted backup before each risky upgrade. What's missing is a proper plan:
   - where backups live (in Canada);
   - who is allowed to approve a restore;
   - a practice run proving we can actually restore within a target time.
5. **Background jobs.** Some tasks are meant to run on a timer, such as sending queued updates to QuickBooks or retrying carrier calls. Nothing runs them automatically yet; they are only started by hand.
6. **Your business rules.** The system has settings but no confirmed values for:
   - taxes;
   - payment terms and credit limits;
   - case-pack sizes;
   - which products need serial numbers;
   - how long to keep records.

   Someone needs to fill these in and sign off.

7. **Your real product data.** Two kinds of data are still missing:
   - links from each Gree model to the exact item you sell;
   - which contractors may buy which products.

   We deliberately didn't invent these.

8. **Software licences.** Two small building blocks (Fontkit and abstract-logging) need their licence paperwork confirmed by a reviewer.
9. **Real-world testing:**
   - your actual phones, barcode scanners and label printers;
   - test accounts with Stripe, QuickBooks and the carriers;
   - confirmation that data and logs really stay in Canada;
   - speed under load.
10. **Moving in.** We need your real starting data (customers, stock, open invoices) and independent totals to check it against. Then a practice switch-over.
11. **Trial run and sign-off.** A couple of weeks of real staff using it at both warehouses, then a formal checklist sign-off. Every formal checkpoint is currently marked "not verified", and none can be marked passed until this happens.
12. **Leftover optional ideas.** A warranty summary panel, a link to Project UB, and remembering report layouts across devices are on hold until you say whether you want them.

## Decisions you need to make, with recommendations

Decision 2 (session-ended handling) is settled and built; see the list after the table.

| #   | Question                                                                                     | Recommendation                                                                                                                                                                                                                                                                | Why                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Is the look and flow right?                                                                  | Spend 20 minutes on your phone and a laptop: browse products, sign in as the sample customer and the administrator, open an order and an invoice. Send back anything you dislike.                                                                                             | Only you can accept the design. Automated tests can't judge it.                                                                                           |
| 3   | Which email service should send invitations and notices?                                     | Choose a service that can process mail in Canada and that you are comfortable signing up for, then give us access. One example is Amazon SES in its Canada region; we haven't checked its current terms. Until then, keep the manual invitation links.                        | You've required Canadian data residency, so where the email service processes mail matters. Nothing should be sent automatically until that is settled.   |
| 4   | Purolator.                                                                                   | Ask your Purolator account representative for E-Ship Web Services developer access and documentation. Use Purolator's own tool in the meantime.                                                                                                                               | Without their official documentation, anything we build would be guesswork. This direction was accepted on 2026-10-03.                                    |
| 5   | Backups and restores.                                                                        | Keep an encrypted copy of the database somewhere in Canada, separate from Fly. Name two people who must both approve a restore, one for money and one for security. Practise a restore every quarter. Aim to lose no more than 15 minutes of data and be back within 4 hours. | These targets were proposed on 2026-10-03. They are goals to test, not promises.                                                                          |
| 6   | How should background jobs run?                                                              | For the pilot, run them on a timer inside the one existing app machine.                                                                                                                                                                                                       | The pilot's database lives on one machine. A second machine would have its own separate database and get out of sync. Revisit when you outgrow the pilot. |
| 7   | Business rules.                                                                              | Have finance and the warehouse lead fill in one shared sheet: taxes, terms, credit, case packs, serial rules, retention. We can prepare the sheet from the system's current settings.                                                                                         | The system must not guess payment terms or tax treatment.                                                                                                 |
| 8   | Product links and buying permissions.                                                        | Have a staff member enter the Gree model-to-product links and each contractor's allowed products in the system, starting with your best sellers.                                                                                                                              | This is your commercial data. We must not invent it.                                                                                                      |
| 9   | Licences.                                                                                    | Ask whoever reviews your legal paperwork to confirm the two licences. If either can't be confirmed, we replace that component.                                                                                                                                                | Using code requires the right to use it.                                                                                                                  |
| 10  | When do you switch from sample data to real data?                                            | Not before items 3 to 9 are done. On the day you switch: turn off the public pre-filled administrator and customer logins, change both passwords, and sign everyone out.                                                                                                      | Those pre-filled logins are deliberately public right now. That is fine for fake data and unsafe for real data.                                           |
| 11  | Real devices.                                                                                | Pick the exact phone models, scanner and label printer the warehouses will use, so we can test each one.                                                                                                                                                                      | Device behaviour, especially iPhone cameras, can't be confirmed in a simulator.                                                                           |
| 12  | Optional extras (warranty summary, Project UB link, layouts that follow you across devices). | Keep them on hold until after the trial run.                                                                                                                                                                                                                                  | They aren't needed to operate, and each adds work and risk.                                                                                               |

Decisions already settled, recorded for reference:

- Staff who sign out now return to the Administration sign-in page, and customers return to the customer sign-in page.
- When the server ends someone's session behind the scenes, the screen now notices right away: the next action shows the sign-in page with "Your session has ended. Sign in again." (decided and built 2026-10-06).
- Pressing the browser's Refresh keeps the count-state filter shown in the address bar.
