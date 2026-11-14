# Propuesta para el autor de sockseek (BORRADOR: no publicado)

- **Dónde:** un *issue* en https://github.com/fiso64/sockseek, con el parche adjunto. Es un issue y no un pull request porque el cambio cae en la librería Soulseek.NET (de otro autor), no en sockseek. Si el autor lo prefiere, se arma después como pull request a Soulseek.NET (https://github.com/jpdillingham/Soulseek.NET).
- **Desde qué cuenta:** la de GitHub dueña del repositorio de PAILA (`epitelio-ar`). Sale público y con ese nombre.
- **Se publica solo con el OK final del dueño del proyecto** sobre este texto exacto.

---

**Title:** Searches flood home routers with thousands of simultaneous outbound connections when the listen port is closed

**Body:**

Hi, and thanks for sockseek!

**What happens.** When the listening port is not reachable from outside (very common: no UPnP, no port forwarding), every peer that has results for a search asks the server to make *us* connect to *them* (`ConnectToPeer`, type `P`). Soulseek.NET handles each of these immediately. For a popular query (e.g. "Led Zeppelin Dancing Days"), that means **~4,500–5,500 outbound TCP connections being opened within 3–8 seconds** (counted with `netstat`, `SYN_SENT` state).

On a common ISP-provided home router, this fills the NAT/connection table. The router then **drops every new connection for several seconds up to ~2 minutes**: other internet traffic included, and also the download connections themselves. So every download attempt fails with `Failed to establish a direct or indirect transfer/message connection to <user>`. I confirmed that the same peers answered within 50–250 ms once the network had recovered. SoulseekQt on the same PC and network downloads fine.

Measured with sockseek 3.0.6 on Windows (closed listen port, 3-track CSV):

| Run | Peak simultaneous connection attempts | Internet outage | Downloaded |
|---|---|---|---|
| sockseek 3.0.6 | ~5,500 | ~2 min | 0 / 3 |
| `--concurrent-searches 1`, spaced searches | ~4,400 | > 1 min | 0 / 3 |
| with the throttle below | ~55 | none | 3 / 3 |

`--concurrent-searches`, `--searches-per-time` and `--no-listen` don't help, because the flood comes from a single search.

**Proposed fix (tested).** Throttle only the solicited `P` connections in `ServerMessageHandler`. At most N in flight (48), at most M started per second (25), and requests that waited more than T (6 s) are dropped. Dropping only loses some search responses. Peers we are currently downloading from bypass the queue, so transfers are never delayed. The defaults can be tuned with environment variables (`SOULSEEK_SOLICITED_MAX`, `SOULSEEK_SOLICITED_PER_SECOND`, `SOULSEEK_SOLICITED_WAIT_MS`; `MAX=0` disables it), but options in `SoulseekClientOptions` would be cleaner upstream. The patch against Soulseek.NET 10.0.2 is attached: one new class plus about 12 changed lines.

With it, searches still return plenty of results (tens to hundreds of files instead of hundreds to thousands), and downloads work with the port closed. I also passed `--search-timeout 8000`, because responses now arrive more spread out.

Would you consider adding something like this (or exposing a setting so it can live in Soulseek.NET)? Happy to adapt it, or to open the PR against Soulseek.NET instead if you prefer.

*(Adjunto: `freno.patch`.)*
