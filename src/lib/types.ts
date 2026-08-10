export type Verdict = "justified" | "premature" | "not_on_schedule";
export type ItemStatus = "overdue" | "due_now" | "not_due";

export type DiyInfo = {
  partCostRange: string;
  minutes: number;
  note: string;
};

export type FindingsItem = {
  service: string;
  category: "routine" | "major";
  status: ItemStatus;
  milesInfo: string;
  diy?: DiyInfo;
};

export type QuoteVerdict = {
  item: string;
  verdict: Verdict;
  explanation: string;
  diy?: DiyInfo;
};

export type DutyClassification = "normal" | "severe";

export type PriceVerdict = "in_range" | "high" | "low" | "unknown";

export type PriceAssessment = {
  verdict: PriceVerdict;
  explanation: string;
  sources: string[];
};

export type RecallItem = {
  component: string;
  summary: string;
  remedy: string;
  campaignNumber: string;
};

export type RecallSummary = {
  count: number;
  items: RecallItem[];
};

export type Findings = {
  vehicle: { year: string; make: string; model: string; trim?: string };
  mileage: number;
  scheduleSource: string;
  exactMatch: boolean;
  items: FindingsItem[];
  quoteVerdicts: QuoteVerdict[];
  summary: string;
  dutyClassification?: DutyClassification;
  dutyReason?: string;
  disputeDraft?: string;
  transcribedItems?: string[];
  priceAssessment?: PriceAssessment;
  scheduleSources?: string[];
  recalls?: RecallSummary;
};

export type AgentEvent =
  | { type: "tool_call"; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: unknown }
  | { type: "final"; findings: Findings }
  | { type: "error"; message: string };

export type ChatMessage = { role: "user" | "assistant"; content: string };
