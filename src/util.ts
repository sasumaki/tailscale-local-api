// Remedajs implementation of toCamelCase
// @see https://github.com/sindresorhus/type-fest/blob/main/source/internal/characters.d.ts#L5-L31
const WHITESPACE = [
  "\u{9}", // '\t'
  "\u{A}", // '\n'
  "\u{B}", // '\v'
  "\u{C}", // '\f'
  "\u{D}", // '\r'
  "\u{20}", // ' '
  "\u{85}",
  "\u{A0}",
  "\u{1680}",
  "\u{2000}",
  "\u{2001}",
  "\u{2002}",
  "\u{2003}",
  "\u{2004}",
  "\u{2005}",
  "\u{2006}",
  "\u{2007}",
  "\u{2008}",
  "\u{2009}",
  "\u{200A}",
  "\u{2028}",
  "\u{2029}",
  "\u{202F}",
  "\u{205F}",
  "\u{3000}",
  "\u{FEFF}",
] as const;

// @see https://github.com/sindresorhus/type-fest/blob/main/source/internal/characters.d.ts#L33
const WORD_SEPARATORS = new Set(["-", "_", ...WHITESPACE]);

export const words = <S extends string>(
  data: S,
): string extends S ? Array<string> : any => {
  const results: Array<string> = [];
  let word = "";

  const flush = (): void => {
    if (word.length > 0) {
      results.push(word);
      word = "";
    }
  };

  for (const character of data) {
    if (WORD_SEPARATORS.has(character)) {
      // Separator encountered; flush the current word & exclude the separator.
      flush();
      continue;
    }

    // Detect transitions:
    // 1. Lowercase to uppercase (e.g., "helloWorld")
    if (/[a-z]$/u.test(word) && /[A-Z]/u.test(character)) {
      flush();
    }
    // 2. Uppercase to lowercase following multiple uppercase letters (e.g., "HELLOWorld")
    // When the text transitions from 2 upper case letters to a lower case
    // letter. (one upper case letter is considered part of the word, e.g.
    // "Dog").
    else if (/[A-Z][A-Z]$/u.test(word) && /[a-z]/u.test(character)) {
      const lastCharacter = word.slice(-1);
      word = word.slice(0, -1);
      flush();
      word = lastCharacter;
    }
    // 3. Digit to non-digit or non-digit to digit (e.g., "123abc" or "abc123")
    else if (/\d$/u.test(word) !== /\d/u.test(character)) {
      flush();
    }

    // Add the current character to the current word.
    word += character;
  }

  flush();

  return results;
};
const LOWER_CASE_CHARACTER_RE = /[a-z]/u;

export const toCamelCase = (
    data: string
  ): string =>
    words(
      LOWER_CASE_CHARACTER_RE.test(data)
        ? data
        : // If the text doesn't have **any** lower case characters we also lower
          // case everything, but if it does we need to maintain them as it
          // affects the word boundaries.
          data.toLowerCase(),
    )
      .map(
        (word, index) =>
          `${
            (index === 0
              ? // The first word is uncapitalized, the rest are capitalized
                word[0]?.toLowerCase()
              : word[0]?.toUpperCase()) ?? ""
          }${word.slice(1)}`,
      )
      .join("");

export const toCamelCaseKeys = <T>(data: T): T => {
  if (Array.isArray(data)) {
    return data.map(item => toCamelCaseKeys(item)) as T;
  }

  if (data !== null && typeof data === 'object') {
    const result: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(data)) {
      const camelKey = toCamelCase(key);
      result[camelKey] = toCamelCaseKeys(value);
    }
    
    return result as T;
  }

  return data;
};