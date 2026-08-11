export type Verdict = "justified" | "premature" | "not_on_schedule";
export type ItemStatus = "overdue" | "due_now" | "not_due";

export type DiyInfo = {
  partCostRange: string;
  minutes: number;
  note: string;
};

export type Priority = "safety" | "soon" | "can_wait";

export type FindingsItem = {
  service: string;
  category: "routine" | "major";
  status: ItemStatus;
  milesInfo: string;
  diy?: DiyInfo;
  priority?: Priority;
};

// A quoted service, as entered by the user (typed row or extracted from a
// photo) — price is optional since a typical-range lookup has value even
// without one to compare against. Used both as the request-body shape for
// `quote` and for the vision-transcription result.
export type QuoteItemInput = {
  service: string;
  price?: number;
};

export type PriceComparisonVerdict = "over" | "under" | "in_range" | "unknown";

export type PriceComparison = {
  typicalLow: number;
  typicalHigh: number;
  verdict: PriceComparisonVerdict;
  sources: string[];
};

export type QuoteVerdict = {
  item: string;
  verdict: Verdict;
  explanation: string;
  diy?: DiyInfo;
  priceQuoted?: number;
  priceComparison?: PriceComparison;
};

export type DutyClassification = "normal" | "severe";

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
  transcribedItems?: QuoteItemInput[];
  scheduleSources?: string[];
  recalls?: RecallSummary;
  actionPlan?: string;
};

export type AgentEvent =
  | { type: "tool_call"; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: unknown }
  | { type: "final"; findings: Findings }
  | { type: "error"; message: string };

export type ChatMessage = { role: "user" | "assistant"; content: string };
