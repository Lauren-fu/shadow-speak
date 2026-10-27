// Half-open ranges select the next phrase at a shared boundary, and none in gaps/ads.
export function currentPhrase(phrases, time, isAd = false) {
  if (isAd || !Number.isFinite(time) || time < 0) return -1;
  return phrases.findIndex(phrase => time >= phrase.start && time < phrase.end);
}
