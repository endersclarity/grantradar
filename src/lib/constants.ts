export const GRANT_CATEGORIES = [
  "Agriculture",
  "Animal Services",
  "Consumer Protection",
  "Disadvantaged Communities",
  "Disaster Prevention & Relief",
  "Education",
  "Employment, Labor & Training",
  "Energy",
  "Environment & Water",
  "Food & Nutrition",
  "Health & Human Services",
  "Housing, Community and Economic Development",
  "Law, Justice, and Legal Services",
  "Libraries and Arts",
  "Parks & Recreation",
  "Science, Technology, and Research & Development",
  "Transportation",
  "Veterans & Military",
] as const;

export type GrantCategory = (typeof GRANT_CATEGORIES)[number];

export const CA_GRANTS_CSV_URL =
  "https://data.ca.gov/dataset/e1b1c799-cdd4-4219-af6d-93b79747fffb/resource/111c8c88-21f6-453c-ae2c-b4785a0624f5/download/california-grants-portal-data.csv";

export const MIN_CSV_ROWS_SAFETY = 50;
