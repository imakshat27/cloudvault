/**
 * Text Chunking Utility
 * Implements fixed-size window chunking (~500 tokens, ~50 token overlap)
 * as specified in the CloudVault architecture specification.
 */

export function chunkText(text, { targetChunkSize = 450, overlapSize = 50 } = {}) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  // Normalize whitespace
  const cleanText = text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
  if (cleanText.length === 0) {
    return [];
  }

  // Tokenize by words (good baseline approximation for English text: 1 word ~ 1.3 tokens)
  const words = cleanText.split(' ');
  const chunks = [];

  let startIndex = 0;
  let chunkIndex = 0;

  while (startIndex < words.length) {
    const endIndex = Math.min(startIndex + targetChunkSize, words.length);
    const chunkWords = words.slice(startIndex, endIndex);
    const content = chunkWords.join(' ').trim();

    if (content.length > 0) {
      chunks.push({
        chunkIndex,
        content
      });
      chunkIndex++;
    }

    if (endIndex >= words.length) {
      break;
    }

    // Step forward by (targetChunkSize - overlapSize)
    startIndex += (targetChunkSize - overlapSize);
  }

  return chunks;
}
