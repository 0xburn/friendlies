import { Notification } from 'electron';

const { characters } = require('@slippi/slippi-js') as {
  characters: typeof import('@slippi/slippi-js').characters;
};

function characterLabel(characterId: number): string {
  try {
    const name = characters.getCharacterName(characterId);
    if (name) return name;
  } catch {
    /* ignore */
  }
  return `Character ${characterId}`;
}

export function showOpponentNotification(
  opponentCode: string,
  opponentName: string,
  characterId: number,
): void {
  try {
    if (!Notification.isSupported()) return;
    const charName = characterLabel(characterId);
    const n = new Notification({
      title: 'Slippi Friends',
      body: `${opponentName || opponentCode} (${opponentCode}) — ${charName}`,
    });
    n.show();
  } catch (e) {
    console.error('showOpponentNotification failed', e);
  }
}

export function showFriendOnlineNotification(
  connectCode: string,
  newStatus: string,
): void {
  try {
    if (!Notification.isSupported()) return;
    const label = newStatus === 'in-game' ? 'is now in game' : 'is now online';
    const n = new Notification({
      title: 'Slippi Friends',
      body: `${connectCode} ${label}`,
    });
    n.show();
  } catch (e) {
    console.error('showFriendOnlineNotification failed', e);
  }
}

export function showFriendRequestNotification(
  fromCode: string,
  onClick?: () => void,
): void {
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: 'Slippi Friends',
      body: `${fromCode} sent you a friend request`,
    });
    if (onClick) n.on('click', onClick);
    n.show();
  } catch (e) {
    console.error('showFriendRequestNotification failed', e);
  }
}
