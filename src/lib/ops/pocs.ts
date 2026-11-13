// The sales team (POCs), as a list to pick from in Slack and on the dashboard. "Other" lets a new or visiting
// seller type their name, so nobody is ever blocked. Edit this list when the team changes.

export const POC_OTHER = "Other";

export const POC_NAMES: readonly string[] = [
  "Abdul Rehman", "Aishwarya", "Ajith Kumar K", "Akshay A", "Ashok Kahar", "Baljeet Singh", "Bhuvaneshwari", "Chandan K S",
  "D Prasanth", "Devangi", "Gowda Jyothi Ramesh", "Gulsan Jahan Talukdar", "Hemanth Kumar", "Ibrahim", "Ikram Pasha",
  "Kaustubh", "Krishna", "Laxman", "M Prashanth", "Mansoor", "Mohammed Afsar", "Naveed Pasha", "Pavan Kalyan", "Piyush",
  "Pranshanth J", "Roseline", "Roshan Shariff", "Sanjay", "Sanjay Kumar", "Shadab", "Simon", "Simon H", "Srikanth",
  "Suman Kumar Panda", "Tushar Ranjan", "Vijay Kanth", "Vikas Singh", "Vishal Kumar Halcheri",
];

/** The list as shown: every name, then Other. */
export const POC_CHOICES: readonly string[] = [...POC_NAMES, POC_OTHER];

/** The POC to save: the picked name, or the typed name when Other was picked. Empty when nothing usable. */
export function pocFromChoice(picked: string, typed: string): string {
  const choice = picked.trim();
  if (choice === POC_OTHER) return typed.replace(/\s+/g, " ").trim();
  return choice || typed.replace(/\s+/g, " ").trim();
}
