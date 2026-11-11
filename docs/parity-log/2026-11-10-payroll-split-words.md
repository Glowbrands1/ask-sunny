# Sunny-only: PAYROLL_SPLIT_WORDS_ENABLED ("not pay roll deductable" answers the payroll question)

sf-s23 (Pau, 5 Nov 2026): after "can you write me a Ca for <A> for performance for october", the answer "not pay roll
deductable" was not read as payroll No here, and the card asked the payroll question again. With the flag, the payroll
reader reads "pay roll" as "payroll" and "deductable" / "deductible" as "deduct".

Not needed in the sibling app (checked on its main 486d9599): its twin case
`nov5-twin-sf-s23-payroll-answer-and-policy-change` already holds with its production flags, and is kept there as a
guard.
