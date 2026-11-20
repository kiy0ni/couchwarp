import { t } from '../i18n'
import type { RoomCard as Room } from '../lib/directory'
import { GameCover } from './GameCover'
import { Link } from './Link'

const LIGHTS = 4

/** A public room: its picture, then what it is and who sits in it. */
export function RoomCard({ room }: { room: Room }) {
  const free = Math.max(0, room.maxPlayers - room.players)
  return (
    <Link className="room-card" to={`/${room.code}`} aria-label={t.browse.join(room.title)}>
      <span className="room-card__picture">
        {room.thumbnailUrl ? (
          <img src={room.thumbnailUrl} alt="" loading="lazy" width={320} height={180} />
        ) : (
          <GameCover sources={[room.gameHeader]} />
        )}
        <span className="room-card__proximity" data-proximity={room.proximity}>
          {t.browse.proximity[room.proximity]}
        </span>
      </span>
      <span className="room-card__body">
        <span className="room-card__title">{room.title}</span>
        {room.game && <span className="room-card__game">{room.game}</span>}
        <span className="room-card__host">{t.browse.hostedBy(room.hostName)}</span>
        <span className="room-card__seats">
          <span className="seats" aria-hidden="true">
            {room.avatars.map((avatar, index) => (
              <Seat
                // biome-ignore lint/suspicious/noArrayIndexKey: seats have no identity but their place
                key={index}
                player={index + 1}
                avatar={avatar}
              />
            ))}
            {Array.from({ length: free }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: empty seats are interchangeable
              <i key={`free-${index}`} className="seats__free" />
            ))}
          </span>
          <span>{t.browse.seats(room.players, room.maxPlayers)}</span>
          {room.spectators > 0 && (
            <span className="room-card__watching">{t.browse.watching(room.spectators)}</span>
          )}
        </span>
      </span>
    </Link>
  )
}

/** An occupied seat: the player's avatar, ringed in the colour of their light. */
function Seat({ player, avatar }: { player: number; avatar: string | null }) {
  const light = ((player - 1) % LIGHTS) + 1
  return avatar ? (
    <img className="seats__taken" data-player={light} src={avatar} alt="" width={24} height={24} />
  ) : (
    <i className="seats__taken" data-player={light} />
  )
}
