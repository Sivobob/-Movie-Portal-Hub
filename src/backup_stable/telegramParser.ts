export interface ParsedTelegramLink {
  isValid: boolean;
  isPrivate: boolean;
  isInviteLink: boolean;
  chatId: string;
  rawChannelId: string;
  messageId: string;
  inviteHash: string;
  originalUrl: string;
}

export function parseTelegramUrl(urlStr: string): ParsedTelegramLink {
  const cleanUrl = (urlStr || '').trim();
  const result: ParsedTelegramLink = {
    isValid: false,
    isPrivate: false,
    isInviteLink: false,
    chatId: '',
    rawChannelId: '',
    messageId: '',
    inviteHash: '',
    originalUrl: cleanUrl,
  };

  if (!cleanUrl) return result;

  const inviteMatch = cleanUrl.match(/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/(?:\+|joinchat\/)([a-zA-Z0-9_-]+)/i);
  if (inviteMatch) {
    result.isValid = true;
    result.isPrivate = true;
    result.isInviteLink = true;
    result.inviteHash = inviteMatch[1];
    return result;
  }

  const privateMatch = cleanUrl.match(/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/c\/(\d+)\/(\d+)/i);
  if (privateMatch) {
    result.isValid = true;
    result.isPrivate = true;
    result.rawChannelId = privateMatch[1];
    result.messageId = privateMatch[2];
    result.chatId = `-100${privateMatch[1]}`;
    return result;
  }

  const publicMatch = cleanUrl.match(/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/([a-zA-Z0-9_]{4,})\/(\d+)/i);
  if (publicMatch) {
    const username = publicMatch[1];
    if (!['joinchat', 'share', 'addstickers', 'contact'].includes(username.toLowerCase())) {
      result.isValid = true;
      result.isPrivate = false;
      result.rawChannelId = username;
      result.messageId = publicMatch[2];
      result.chatId = `@${username}`;
      return result;
    }
  }

  return result;
}
