export type LiveConnection = "demo" | "not_configured" | "connecting" | "on" | "reconnecting" | "unavailable" | "offline";

export function connectionLabel(status: LiveConnection): string {
  switch (status) {
    case "demo":
      return "Demo data";
    case "not_configured":
      return "Live updates not configured";
    case "connecting":
      return "Connecting";
    case "on":
      return "Live updates on";
    case "reconnecting":
      return "Reconnecting";
    case "unavailable":
      return "Live updates unavailable";
    case "offline":
      return "Live updates off";
  }
}
