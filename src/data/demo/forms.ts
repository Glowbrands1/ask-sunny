import type { GeneratedForm, GeneratedFormStatus } from "@/types";
import { daysFromNow, isoDaysFromAnchor } from "@/lib/utils/date";

/**
 * Seeded forms feeding Form Monitoring — DEMO CONTENT.
 * All employee names are fictional.
 */

interface FormSeed {
  id: string;
  templateId: string;
  templateName: string;
  employeeName: string;
  employeeRole: string;
  locationId: string;
  locationName: string;
  createdBy: string;
  createdOffset: number;
  followUpOffset: number | null;
  status?: GeneratedFormStatus;
  topic: string;
  details: string;
  expectedAction: string;
  checkedOptions?: Record<string, string[]>;
}

const SEEDS: FormSeed[] = [
  {
    id: "form-2041",
    templateId: "tpl-coaching",
    templateName: "Coaching Form",
    employeeName: "Jane Kowalski",
    employeeRole: "Tanning Consultant",
    locationId: "loc-101",
    locationName: "Riverbend Commons",
    createdBy: "Riverbend Commons",
    createdOffset: -12,
    followUpOffset: -3,
    topic: "Repeated tardiness",
    details:
      "Demo content. Arrived after the start of a scheduled shift on three occasions in the past two weeks. Each instance was between ten and twenty minutes late and was noted on the day.",
    expectedAction:
      "Demo content. Be on the floor and ready to work at the scheduled shift start time, every scheduled shift, beginning immediately.",
    checkedOptions: {
      coaching_type: ["Documented coaching"],
      coaching_topic: ["Attendance / punctuality"],
    },
  },
  {
    id: "form-2038",
    templateId: "tpl-coaching",
    templateName: "Coaching Form",
    employeeName: "Marcus Trent",
    employeeRole: "Tanning Consultant",
    locationId: "loc-104",
    locationName: "Cedar Point Plaza",
    createdBy: "Cedar Point Plaza",
    createdOffset: -16,
    followUpOffset: -1,
    topic: "Membership presentation consistency",
    details:
      "Demo content. Membership conversion has sat below the salon average for three consecutive weeks. Floor observation showed the membership conversation being skipped during busier periods.",
    expectedAction:
      "Demo content. Present membership options to every eligible guest, including during peak periods, and log the outcome.",
    checkedOptions: {
      coaching_type: ["Performance check-in"],
      coaching_topic: ["Sales performance"],
    },
  },
  {
    id: "form-2044",
    templateId: "tpl-policy-review",
    templateName: "Policy Review",
    employeeName: "Sofia Delgado",
    employeeRole: "Assistant Salon Director",
    locationId: "loc-108",
    locationName: "Harborview Landing",
    createdBy: "Harborview Landing",
    createdOffset: -6,
    followUpOffset: 1,
    topic: "Cash handling policy review",
    details:
      "Demo content. Reviewed drawer count expectations, deposit preparation, and how a variance is documented and escalated.",
    expectedAction:
      "Demo content. Follow the documented drawer count procedure at every shift change and report any variance the same day.",
  },
  {
    id: "form-2046",
    templateId: "tpl-coaching",
    templateName: "Coaching Form",
    employeeName: "Owen Bradshaw",
    employeeRole: "Tanning Consultant",
    locationId: "loc-101",
    locationName: "Riverbend Commons",
    createdBy: "Riverbend Commons",
    createdOffset: -4,
    followUpOffset: 3,
    topic: "Room turnover time",
    details:
      "Demo content. Turnover between guests has been running long during evening shifts, creating a visible wait at the front desk.",
    expectedAction:
      "Demo content. Complete the between-guest clean to standard within the expected turnover window on every shift.",
    checkedOptions: {
      coaching_type: ["Verbal coaching"],
      coaching_topic: ["Cleanliness standards"],
    },
  },
  {
    id: "form-2047",
    templateId: "tpl-coaching",
    templateName: "Coaching Form",
    employeeName: "Priscilla Nunez",
    employeeRole: "Tanning Consultant",
    locationId: "loc-112",
    locationName: "Summit Row",
    createdBy: "Summit Row",
    createdOffset: -3,
    followUpOffset: 6,
    topic: "Dress code standard",
    details:
      "Demo content. Name badge has been missing on several shifts and footwear did not meet the salon standard on one occasion.",
    expectedAction:
      "Demo content. Report to every shift in full dress code, including name badge and approved footwear.",
    checkedOptions: {
      coaching_type: ["Verbal coaching"],
      coaching_topic: ["Dress code"],
    },
  },
  {
    id: "form-2032",
    templateId: "tpl-dpoa",
    templateName: "Disciplinary Plan of Action (DPOA)",
    employeeName: "Devon Hartley",
    employeeRole: "Tanning Consultant",
    locationId: "loc-105",
    locationName: "Northgate Square",
    createdBy: "Alicia Moreno",
    createdOffset: -24,
    followUpOffset: -10,
    status: "followed_up",
    topic: "Attendance — written warning",
    details:
      "Demo content. Attendance occurrences continued after a documented coaching conversation on the same topic.",
    expectedAction:
      "Demo content. No further unexcused occurrences during the review period. Call-outs by phone to the Salon Director ahead of the shift.",
    checkedOptions: {
      coaching_topic: ["Attendance / punctuality"],
    },
  },
  {
    id: "form-2029",
    templateId: "tpl-coaching",
    templateName: "Coaching Form",
    employeeName: "Elena Vasquez",
    employeeRole: "Assistant Salon Director",
    locationId: "loc-102",
    locationName: "Maple Crossing",
    createdBy: "Alicia Moreno",
    createdOffset: -31,
    followUpOffset: -17,
    status: "completed",
    topic: "Opening checklist consistency",
    details:
      "Demo content. Opening checklist was incomplete on two audited mornings.",
    expectedAction:
      "Demo content. Complete and confirm the full opening checklist before the first guest is served.",
    checkedOptions: {
      coaching_type: ["Documented coaching"],
      coaching_topic: ["Cleanliness standards"],
    },
  },
  {
    id: "form-2050",
    templateId: "tpl-coaching",
    templateName: "Coaching Form",
    employeeName: "Tyrell Jacobs",
    employeeRole: "Tanning Consultant",
    locationId: "loc-107",
    locationName: "Stonebridge Market",
    createdBy: "Corey Vandenberg",
    createdOffset: -1,
    followUpOffset: null,
    status: "draft",
    topic: "Client experience — greeting standard",
    details:
      "Demo content. Guests were not consistently acknowledged on arrival during a district visit.",
    expectedAction:
      "Demo content. Acknowledge every guest within fifteen seconds of arrival.",
    checkedOptions: {
      coaching_type: ["Verbal coaching"],
      coaching_topic: ["Client experience"],
    },
  },
  {
    id: "form-2051",
    templateId: "tpl-asd-sdit",
    templateName: "ASD-SDIT Performance EPP",
    employeeName: "Jordan Beckley",
    employeeRole: "Assistant Salon Director",
    locationId: "loc-101",
    locationName: "Riverbend Commons",
    createdBy: "Alicia Moreno",
    createdOffset: -9,
    followUpOffset: 12,
    topic: "Development toward Salon Director",
    details:
      "Demo content. Strong on floor leadership and client experience. Development needed on labor scheduling and documentation cadence.",
    expectedAction:
      "Demo content. Build the schedule independently for four consecutive weeks and document one coaching conversation per week.",
    checkedOptions: {
      competencies: ["Scheduling & labor", "Coaching & documentation"],
    },
  },
  {
    id: "form-2043",
    templateId: "tpl-tsd-epp",
    templateName: "TSD EPP",
    employeeName: "Angela Frost",
    employeeRole: "TSD",
    locationId: "loc-109",
    locationName: "Sandalwood Corner",
    createdBy: "Corey Vandenberg",
    createdOffset: -18,
    followUpOffset: 9,
    topic: "Operational standards",
    details:
      "Demo content. Salon standards audit identified gaps in preventive maintenance logging and inventory counts.",
    expectedAction:
      "Demo content. Complete the maintenance log weekly and submit an accurate inventory count on the published cadence.",
    checkedOptions: {
      competencies: ["Operational standards", "Reporting accuracy"],
    },
  },
  {
    id: "form-2036",
    templateId: "tpl-policy-review",
    templateName: "Policy Review",
    employeeName: "Kai Lindstrom",
    employeeRole: "Tanning Consultant",
    locationId: "loc-110",
    locationName: "Lakeshore Terrace",
    createdBy: "Lakeshore Terrace",
    createdOffset: -21,
    followUpOffset: -14,
    status: "completed",
    topic: "Age verification policy review",
    details:
      "Demo content. Reviewed identification requirements and consent documentation expectations.",
    expectedAction:
      "Demo content. Verify identification on every applicable visit and complete consent documentation before service.",
  },
  {
    id: "form-2049",
    templateId: "tpl-coaching",
    templateName: "Coaching Form",
    employeeName: "Bianca Rowe",
    employeeRole: "Tanning Consultant",
    locationId: "loc-111",
    locationName: "Brookside Village",
    createdBy: "Brookside Village",
    createdOffset: -2,
    followUpOffset: 8,
    topic: "Upgrade conversation",
    details:
      "Demo content. Upgrade conversations are being skipped for returning guests.",
    expectedAction:
      "Demo content. Offer the upgrade conversation to every returning guest whose usage pattern supports it.",
    checkedOptions: {
      coaching_type: ["Performance check-in"],
      coaching_topic: ["Sales performance"],
    },
  },
  {
    id: "form-2035",
    templateId: "tpl-dpoa",
    templateName: "Disciplinary Plan of Action (DPOA)",
    employeeName: "Nathan Ruiz",
    employeeRole: "Tanning Consultant",
    locationId: "loc-106",
    locationName: "Willow Park",
    createdBy: "Alicia Moreno",
    createdOffset: -27,
    followUpOffset: -20,
    status: "followed_up",
    topic: "Policy adherence — documented verbal",
    details:
      "Demo content. Salon closing procedure was not completed to standard on two consecutive closes.",
    expectedAction:
      "Demo content. Complete every closing step in order and confirm completion with the Salon Director.",
    checkedOptions: {
      coaching_topic: ["Policy adherence"],
    },
  },
  {
    id: "form-2052",
    templateId: "tpl-fttc",
    templateName: "FTTC Performance EPP",
    employeeName: "Hollis Grant",
    employeeRole: "FTTC",
    locationId: "loc-103",
    locationName: "Hillcrest Station",
    createdBy: "Alicia Moreno",
    createdOffset: -5,
    followUpOffset: 21,
    topic: "Training delivery consistency",
    details:
      "Demo content. Certification completions are running behind schedule across two salons in the district.",
    expectedAction:
      "Demo content. Bring outstanding certifications current and hold a weekly training block at each assigned salon.",
    checkedOptions: {
      competencies: ["Coaching & documentation", "Operational standards"],
    },
  },
];

/** Derives the monitoring status from the follow-up date, as production will. */
export function deriveStatus(
  followUpDate: string | null,
  explicit?: GeneratedFormStatus,
): GeneratedFormStatus {
  if (explicit) return explicit;
  if (!followUpDate) return "draft";
  const days = daysFromNow(followUpDate);
  if (days < 0) return "overdue";
  if (days <= 3) return "due_soon";
  return "open";
}

export const DEMO_GENERATED_FORMS: GeneratedForm[] = SEEDS.map((seed) => {
  const followUpDate =
    seed.followUpOffset === null ? null : isoDaysFromAnchor(seed.followUpOffset);
  return {
    id: seed.id,
    templateId: seed.templateId,
    templateName: seed.templateName,
    employeeName: seed.employeeName,
    employeeRole: seed.employeeRole,
    locationId: seed.locationId,
    locationName: seed.locationName,
    createdBy: seed.createdBy,
    createdAt: `${isoDaysFromAnchor(seed.createdOffset)}T14:00:00.000Z`,
    formDate: isoDaysFromAnchor(seed.createdOffset),
    followUpDate,
    status: deriveStatus(followUpDate, seed.status),
    values: {
      employee_name: seed.employeeName,
      employee_role: seed.employeeRole,
      location: seed.locationName,
      form_date: isoDaysFromAnchor(seed.createdOffset),
      manager: seed.createdBy,
      topic: seed.topic,
      details: seed.details,
      expected_action: seed.expectedAction,
      follow_up_date: followUpDate ?? "",
    },
    checkedOptions: seed.checkedOptions ?? {},
    archived: false,
  };
});

export const FORM_STATUS_LABEL: Record<GeneratedFormStatus, string> = {
  draft: "Draft",
  open: "Open",
  due_soon: "Due soon",
  overdue: "Overdue",
  followed_up: "Followed up",
  completed: "Completed",
};
