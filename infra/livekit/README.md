# Self-hosted LiveKit

One copy of this stack per environment (staging, production), each on its own
Hetzner server with its own domains and its own API key. Two environments must
never share a LiveKit key: a key can join **any room** in its server.

What runs on the server (all in Docker, host networking): LiveKit server,
Egress (recording), Redis (how those two talk), and Caddy (certificates, and
sends both signalling and TURN-over-TLS through port 443, which is what lets
students on locked-down school Wi-Fi connect).

The app needs **no code change**. It reads `NEXT_PUBLIC_LIVEKIT_URL`,
`LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`, and recordings still go to R2.
Moving an environment over is: stand up the server, change those three Vercel
variables, redeploy.

| File | Purpose |
| --- | --- |
| `docker-compose.yaml` | The four services, versions pinned |
| `*.yaml.template`, `redis.conf` | Config; `setup.sh` fills in domains and keys |
| `setup.sh` | Installs/upgrades everything on the server, generates the API key |
| `deploy.sh` | The only command the CI deploy key may run on the server; checks for live calls, then runs `setup.sh` |
| `check.sh` | Run from your laptop to verify DNS, TLS, ports and TURN |

Day to day you will not run `setup.sh` by hand: the **Deploy LiveKit** workflow
does (see [Updating the server](#updating-the-server)).

## Our environments

| | Names | Server | App | Status |
| --- | --- | --- | --- | --- |
| Staging | `livekit-staging.hybridtutors.co.uk`, `turn-staging.hybridtutors.co.uk` | Hetzner CX23 (2 shared vCPU, 4 GB), Nuremberg | `tutors-dev` | Live; verified with four simultaneous sessions |
| Production | not created yet (`livekit.hybridtutors.co.uk`, `turn.hybridtutors.co.uk` are the intended names) | not created yet | `tutors` | Still on the LiveKit Cloud project `kindling` |

## Set up an environment

You need: a domain you can add DNS records to, a Hetzner Cloud account, and
Vercel/GitHub access. Do **staging first**.

### 1. Names

Pick two names per environment, for example `livekit-staging.<domain>` and
`turn-staging.<domain>`. (`*.vercel.app` names cannot be used: Caddy needs DNS
you control to get certificates.)

### 2. Hetzner server

1. Console → **Security → SSH keys**: add your public key.
2. **Firewalls → Create firewall**, inbound rules, source any unless noted:
   TCP `22` (restrict to your own IP if it is stable), TCP `80`, TCP `443`,
   TCP `7881`, UDP `3478`, UDP `50000-60000`. Allow all outbound.
3. **Servers → Add server**: location Falkenstein, Nuremberg or Helsinki
   (the included 20 TB traffic applies to EU locations only); image Ubuntu
   24.04 (staging runs 26.04.1 without problems, but 24.04 is what the script
   was written for); a plan sized from [Capacity](#capacity-and-sizing) (check
   current plan names and prices in the console); IPv4 enabled; select your SSH
   key and the firewall above.
4. Note the server's public IPv4.

### 3. DNS

Create two **A records** pointing at that IPv4. If the domain is on
Cloudflare, set both to **DNS only** (grey cloud): WebRTC and TURN cannot go
through Cloudflare's proxy.

### 4. Install

The repository is private, so copy the directory from your checkout instead of
cloning it on the server:

```sh
scp -r infra/livekit root@<server-ip>:/root/livekit
ssh root@<server-ip>
cd /root/livekit && chmod +x *.sh
LIVEKIT_DOMAIN=livekit-staging.<domain> \
TURN_DOMAIN=turn-staging.<domain> \
WEBHOOK_URL=https://tutors-dev.vercel.app/api/webhooks/livekit \
./setup.sh
```

This is the only time a server is set up by hand. Afterwards it is updated by
the Deploy LiveKit workflow, once you have given that workflow its key (see
[Updating the server](#updating-the-server)).

The script refuses to continue if DNS does not point at the server, and it
prints the three values to put in Vercel. They are also stored in
`/opt/livekit/.env` (root only). Re-running the script keeps the same key.

### 5. Verify from your laptop

```sh
infra/livekit/check.sh livekit-staging.<domain> turn-staging.<domain>
```

On the server, also confirm Egress started and registered:
`cd /opt/livekit && docker compose logs egress | tail`. Look for
`service ready`.

### 6. Point the app at it

In the **staging** Vercel project (`tutors-dev`, Production scope) replace:

- `NEXT_PUBLIC_LIVEKIT_URL` = `wss://livekit-staging.<domain>`
- `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` = the values from the script

Then redeploy staging (Actions → **Deploy staging** → Run workflow).
`NEXT_PUBLIC_*` values are baked in at build time, so changing the variable
alone is not enough. The webhook is already configured on the server by
`WEBHOOK_URL`; nothing to change in the LiveKit Cloud dashboard.

### 7. Test (on staging, before trusting it)

- A tutor and student in one call on different networks: audio and video both ways.
- The student on **mobile data**, and on a network that blocks UDP (a phone
  hotspot with a restrictive VPN, or school Wi-Fi). This is the test that
  matters: it proves TURN over 443 works.
- Tutor screen share: a recording appears and plays beside the audio.
- Audio recording: the session page plays it, a transcript and notes appear.
- Several calls at once, with Egress watched. A refused job shows up in the
  app as a recording that fails after 10 s, not as a log line (see
  [Capacity](#capacity-and-sizing)); check every call produced both an audio
  and a screen recording.
- Reload the server (`sudo reboot`) and confirm everything comes back by
  itself.

## Updating the server

Changes to anything in this directory reach a server through the **Deploy
LiveKit** workflow (`.github/workflows/deploy-livekit.yml`), run by hand from
the Actions tab:

- **target:** `staging` or `production`. Staging can run from any branch, so an
  infrastructure change can be tried before it merges; production only from
  `main`, and only after typing `deploy`.
- **force:** off by default. The server counts the people connected to its
  rooms and refuses to restart while anyone is in a call, because installing a
  configuration restarts LiveKit, Egress and Caddy and drops every call. Tick
  it only when dropping calls is acceptable.

It packs this directory, sends it over SSH, runs `setup.sh` there (which keeps
the existing keys and domains) and then runs `check.sh` against the server,
retrying for two minutes while certificates settle. A red run means the server
needs a look, not that the change was necessarily wrong; the previous files are
kept in `/root/livekit.previous`.

The workflow reads only its own target's settings:

| Name | Kind | Value |
| --- | --- | --- |
| `STAGING_LIVEKIT_DEPLOY_KEY` | secret | Private half of the deploy key |
| `STAGING_LIVEKIT_DEPLOY_HOST` | variable | The server's DNS name |
| `STAGING_LIVEKIT_HOST_KEY` | variable | Its `ssh-keyscan -t ed25519` line (pins the server) |
| `STAGING_LIVEKIT_DOMAIN` / `STAGING_LIVEKIT_TURN_DOMAIN` | variables | The two names, for the post-deploy check |

`PRODUCTION_*` are the same five for the production server.

### Setting it up for a new server (once)

The deploy key can run exactly one thing on the server, `deploy.sh`, and cannot
open a shell, forward ports or run anything else. From your machine, after the
first `setup.sh` run (which installs `/usr/local/bin/livekit-deploy`):

```sh
ssh-keygen -t ed25519 -N "" -C "github-actions livekit-production deploy" -f ./deploy-key
ssh root@<server> "echo 'restrict,command=\"/usr/local/bin/livekit-deploy\" $(cat deploy-key.pub)' >> /root/.ssh/authorized_keys"

gh secret set PRODUCTION_LIVEKIT_DEPLOY_KEY < deploy-key
ssh-keyscan -t ed25519 <livekit-domain> | gh variable set PRODUCTION_LIVEKIT_HOST_KEY
gh variable set PRODUCTION_LIVEKIT_DEPLOY_HOST --body <livekit-domain>
gh variable set PRODUCTION_LIVEKIT_DOMAIN --body <livekit-domain>
gh variable set PRODUCTION_LIVEKIT_TURN_DOMAIN --body <turn-domain>
rm deploy-key deploy-key.pub
```

To revoke it, delete that line from `authorized_keys`. If the server is ever
rebuilt, its host key changes: update `*_LIVEKIT_HOST_KEY` or the workflow will
(correctly) refuse to connect.

## Capacity and sizing

**What was measured** on the staging server (2 shared vCPU, 4 GB) with four
simultaneous sessions, each a tutor and a student in headless Chrome with fake
microphones playing speech and the tutor sharing a synthetic screen, for 90 s:

| | Result |
| --- | --- |
| Recordings | 8 of 8 `ready` (4 audio, 4 screen) once Egress costs were corrected, see below |
| Egress, per job | stereo audio mix about 0.13 cores (peak 0.2); screen-share passthrough about 0.03 |
| Whole server | about 85% of its 200% CPU on average, peaking around 103%; load average peaked at 2.2 |
| Memory | about 960 MB used of 4 GB |

That is "works, with almost no headroom". Do not read it as a ceiling for a
bigger server, and do not read it as proof for real use either:

- **Not tested:** calls lasting an hour (memory growth, long screen-share files
  and their upload), ten or more sessions, real camera video, real networks,
  and students on UDP-blocked or mobile connections.
- **Sizing for production:** per-job CPU suggests four simultaneous sessions
  need roughly one core of recording plus about one of forwarding. Choose
  **4 or more dedicated vCPU** (not shared) and 8 GB, then measure with the
  load test above before trusting it for ten sessions.

**Egress admits jobs by estimated cost, and the defaults are wrong for us.**
Egress accepts a job only if its estimated CPU fits in what is left (80% of the
cores) and holds that estimate for 15 s after accepting it. The app starts only
"media" jobs, priced as `participant_cpu_cost` (the stereo audio mix, default
2.0) and `track_cpu_cost` (a passthrough screen share, default 0.5).
On a 2-vCPU server the default fills the machine with one audio job, so the
same call's screen share, or another call's audio, is refused. Nothing is
logged; LiveKit reports it 10 s later as `request canceled` and the recording is
marked `failed`. `egress.yaml.template` therefore sets 0.2 and 0.1, above the
measured averages. At 0.3/0.2, two of four simultaneous screen shares were
refused. If you resize the server, these values still work; if you ever see
recordings failing after exactly 10 s, look here first.

## Rolling back

Put the three Vercel variables back to the LiveKit Cloud values and redeploy.
Calls in progress drop; new ones use Cloud. Keep the Cloud project until the
self-hosted setup has run cleanly for a while.

## Production

Repeat steps 1 to 7 with new names (`livekit.<domain>`, `turn.<domain>`),
a **separate server**, `WEBHOOK_URL` set to the production app's
`/api/webhooks/livekit`, and the **production** Vercel project. Do not reuse
staging's server or key. This also closes the "staging and production share
one LiveKit project" gap in `docs/CI-CD.md`.

## Operating it

- **Upgrade:** change the pinned image versions in `docker-compose.yaml`
  through a pull request, merge it, then run the **Deploy LiveKit** workflow
  (see below). Read LiveKit's release notes first. Keep Egress at or above v1.15.0.
- **Logs:** `cd /opt/livekit && docker compose logs -f livekit` (or `egress`, `caddy`).
- **Monitoring:** not set up yet. Point an uptime check at
  `https://<livekit-domain>/` (returns 200); an outage means no calls, so alert
  someone who can act. It is on the [backlog](../../docs/backlog.md).
- **Security updates:** `unattended-upgrades` is installed by the script.
- **Rotate the API key:** delete the two key lines from `/opt/livekit/.env`,
  re-run `setup.sh`, then update the Vercel variables and redeploy together.
- **State:** the only things worth backing up are `/opt/livekit/.env` and
  `caddy_data` (certificates, re-issued automatically if lost).
