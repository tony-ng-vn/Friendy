export type DisplayNameMatch = {
  displayName: string;
  score: number;
};

function normalizeDisplayName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function levenshteinDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let row = 0; row < rows; row += 1) {
    matrix[row][0] = row;
  }
  for (let col = 0; col < cols; col += 1) {
    matrix[0][col] = col;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + cost
      );
    }
  }

  return matrix[rows - 1][cols - 1];
}

/** Ranks saved display names against a fuzzy user-provided delete/search target. */
export function rankDisplayNameMatches(query: string, displayNames: string[]): DisplayNameMatch[] {
  const normalizedQuery = normalizeDisplayName(query);
  if (!normalizedQuery) {
    return [];
  }

  const scored = displayNames.map((displayName) => {
    const normalizedName = normalizeDisplayName(displayName);
    if (normalizedName === normalizedQuery) {
      return { displayName, score: 100 };
    }

    if (normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizedName)) {
      return { displayName, score: 80 };
    }

    const queryTokens = normalizedQuery.split(" ").filter(Boolean);
    const nameTokens = normalizedName.split(" ").filter(Boolean);
    let bestTokenScore = 0;

    for (const queryToken of queryTokens) {
      for (const nameToken of nameTokens) {
        if (queryToken === nameToken) {
          bestTokenScore = Math.max(bestTokenScore, 85);
          continue;
        }

        if (queryToken.length >= 4 && nameToken.length >= 4) {
          const distance = levenshteinDistance(nameToken, queryToken);
          if (distance <= 2) {
            bestTokenScore = Math.max(bestTokenScore, 75 - distance);
          }
        }
      }
    }

    if (bestTokenScore > 0) {
      return { displayName, score: bestTokenScore };
    }

    if (normalizedName.length >= 4 && normalizedQuery.length >= 4) {
      const distance = levenshteinDistance(normalizedName, normalizedQuery);
      if (distance <= 2) {
        return { displayName, score: 70 - distance };
      }
    }

    return { displayName, score: 0 };
  });

  return scored.filter((item) => item.score > 0).sort((left, right) => right.score - left.score);
}
