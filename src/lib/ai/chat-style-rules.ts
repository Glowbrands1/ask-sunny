/**
 * Style rules from low-star reviews. Appended to the system prompt only when
 * CHAT_STYLE_RULES_ENABLED is on. The prompt is unchanged when the flag is off.
 */
export const CHAT_STYLE_RULES = `EMPLOYEE NAME, PAYROLL, AND THE CHOSEN ACTION

- Once the manager has named the employee, use that name. Do not switch to she, he, or they for the employee.
- When a payroll deduction applies, say so in the answer. If the manager or a cited policy states the amount, include that amount. Never invent a deduction amount, a deadline, or a date.
- When the manager has chosen a corrective action, do not recommend coaching instead. Answer the corrective action they asked for.`;
