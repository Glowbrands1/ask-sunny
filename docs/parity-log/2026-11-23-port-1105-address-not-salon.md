# Port from Ask Bubbles (4f9f706c, #1105): an address given as the employee's never picks the card's salon (23 Nov 2026)

**Source:** Ask Bubbles #1105 (merged, 4f9f706c; coder 5). Mechanism only; this app's salons, an invented person and an
invented address.

In Ask Bubbles' u22 live run, an exit's T2 "address: 123 Test St, <city>, <state>. 00000" got "Filed at **<city>**, as you
said.": the employee's home address was read as the card's place. Here the same readers read it as the salon.

`address-spans.ts` (new, no imports) holds the exit form's Permanent Address shape (moved out of `exit-details.ts`, which
now imports it) and `typedAddressSpans` / `withoutAddressLines`. Every such address is blanked before a salon is read:

- `readSalonMentions` (salon-mention.ts), which every salon reader here goes through, `labelledSalonIds` included;
- `salonIdNamedIn` (global-salon-ask.ts, a salon's own word, the global non-admin path);
- the card's salon from the manager's words (`proposal.ts`).

In propose_form (`agent-loop/tools.ts`), a salon the model passes that the manager named only inside such an address is
dropped, as if none was typed. Named anywhere else in the request, it stands.

Where this differs from Ask Bubbles: the guard sits in `readSalonMentions` itself, not in a loop-only wrapper (this app's
loop calls it directly), and also in `salonIdNamedIn`, which this app's global non-admin path uses.

Replay: `nov23-agent-loop-home-address-never-the-salon-cases.ts` (Perpetua Lindqvist, address in Manhattan, KS, her salon
Kearney). All four fail before and pass after, the control included: on main the address's city also confused the salon
named outside it. Unit: `address-spans.test.ts`.
