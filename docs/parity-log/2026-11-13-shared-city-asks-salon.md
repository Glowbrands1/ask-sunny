## 13 Nov 2026: a shared city typed a letter off asks which salon; "<A> at <place>" is never the Observation — Sunny only (SHARED_CITY_ASKS_SALON_ENABLED, default off)

QA's Sunny 38c live check, item 6: as an Admin, "create a ca for <A> at omha, she was late" gave no salon question and
the Observation "<A> at omha, she was late". Here "omha" was read as no place, and with the exact "at omaha" an Admin's
card took the employee's own salon from the directory instead of asking which Omaha salon. With the flag: a shared city
a letter off is that city's salons (`salon-mention.ts`), the question among named salons stands over the employee's
single salon when that salon is not one of them (`grounded-entities.ts`), and "<A> at <place>" is dropped from the
Observation (`remap-incident.ts`).

Ask Bubbles: not needed. Checked through its chat route with production's flags (13 Nov 2026, main 7d5b7bb2): its shared
city is Sioux Falls (two stores); "create a ca for <A> at sioux falls, she was late" and "… at sioux fals …" both ask
which Sioux Falls store, as an Admin and as a manager over both, and the employee's own store (Omaha, Dodge) is not
filed. Its store resolver already reads a typo of a store's city.
