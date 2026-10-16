function sanitizeTextForTTS(text) {
  let clean = (text || '')
    .replace(/https?:\/\/\S+/gi, 'link')
    .replace(/(wkwk|haha|hehe|hihi|wk){2,}/gi, 'wkwk')
    .replace(/(.)\1{3,}/gi, '$1$1')
    .replace(/[^\w\s\?,!\.]/gi, '')
    .trim();
  return clean.slice(0, 140);
}

function processSmartChat(chatData, viewerInfo) {
  const rawText = (chatData.message || '').trim();
  const cleanText = rawText.toLowerCase();
  const questionKeywords = [
    '?', 'gimana', 'bagaimana', 'kapan', 'kenapa', 'berapa', 'spill', 'spil',
    'cara', 'mau tanya', 'nanya', 'pakai apa', 'pake apa', 'spek', 'settingan', 'dimana', 'jam berapa'
  ];
  const isQuestion = questionKeywords.some(k => cleanText.includes(k)) && rawText.length > 3;

  const messageId = `${chatData.platform}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const ttsText = `${chatData.author} bilang,${sanitizeTextForTTS(rawText)}`;
  return {
    ...chatData,
    id: messageId,
    isQuestion,
    priorityBadge: viewerInfo.priorityBadge,
    priorityLevel: viewerInfo.priorityLevel,
    ttsText
  };
}

module.exports = { processSmartChat };