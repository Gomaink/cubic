/**
 * Re-authorize a socket that the server explicitly disconnected. Transport
 * failures remain under Socket.IO's normal reconnect behavior.
 * @param {{ connected: boolean, connect: () => void }} socket
 * @param {() => boolean} isActive
 * @param {{ fetchSession?: () => Promise<Response>, redirect?: (path: string) => void }} [options]
 */
export async function recoverAfterServerDisconnect(
  socket,
  isActive,
  {
    fetchSession = () => fetch('/api/v1/auth/session', { credentials: 'include' }),
    redirect = (path) => window.location.assign(path)
  } = {}
) {
  let session = null;
  try {
    const response = await fetchSession();
    if (!response.ok) return;
    session = await response.json();
  } catch {
    return;
  }

  if (session?.authenticated === false) {
    redirect('/login');
    return;
  }

  if (session?.authenticated === true && isActive() && !socket.connected) {
    socket.connect();
  }
}
