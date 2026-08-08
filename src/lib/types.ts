export type Verdict = "justified" | "premature" | "not_on_schedule";
export type ItemStatus = "overdue" | "due_now" | "not_due";

export type FindingsItem = {
  service: string;
  category: "routine" | "major";
  status: ItemStatus;
  milesInfo: string;
};

export type QuoteVerdict = {
  item: string;
  verdict: Verdict;
  explanation: string;
};

export type Findings = {
  vehicle: { year: string; make: string; model: string; trim?: string };
  mileage: number;
  scheduleSource: string;
  exactMatch: boolean;
  items: FindingsItem[];
  quoteVerdicts: QuoteVerdict[];
  summary: string;
};

export type AgentEvent =
  | { type: "tool_call"; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: unknown }
  | { type: "final"; findings: Findings }
  | { type: "error"; message: string };
