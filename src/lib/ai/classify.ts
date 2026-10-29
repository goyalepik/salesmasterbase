export type QuestionKind = "payment_today" | "needs_review" | "contributors" | "week_summary" | "missing_amounts" | "recent";

export function classifyQuestion(question: string): QuestionKind {
  const text = question.toLowerCase();
  if (text.includes("missing amount") || text.includes("ambiguous amount") || text.includes("no amount")) return "missing_amounts";
  if (text.includes("review") || text.includes("exception") || text.includes("attention")) return "needs_review";
  if (text.includes("salesperson") || text.includes("contributor") || text.includes("sender") || text.includes("incentive") || text.includes("most")) return "contributors";
  if (text.includes("week") || text.includes("summar")) return "week_summary";
  if (text.includes("payment") || text.includes("today")) return "payment_today";
  return "recent";
}
