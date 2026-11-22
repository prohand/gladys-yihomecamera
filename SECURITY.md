# Security policy

## Supported versions

Only the latest release of the Yi Home Cameras integration receives security
fixes. Update the integration from the Gladys store before reporting an issue.

| Version      | Supported |
| ------------ | --------- |
| 1.x (latest) | Yes       |
| older        | No        |

## Reporting a vulnerability

Please do **not** open a public issue, pull request or forum post for a
security problem.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-yihomecamera](https://github.com/prohand/gladys-yihomecamera/security),
then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration, of Gladys and of the yi-hack firmware;
- what an attacker can do, and the steps to reproduce it;
- any log line that helps (remove passwords, IP addresses and images first).

You should get a first answer within 7 days. A fix is released as a new version
of the integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes.

Out of scope: Gladys Assistant itself (report to
[GladysAssistant/Gladys](https://github.com/GladysAssistant/Gladys/security)),
the yi-hack firmwares (report to their own projects), the Yi Home cameras and
the MQTT broker.

## How the integration handles your data

- It talks to the cameras on your local network only (HTTP to the yi-hack web
  interface, and optionally your own MQTT broker). It never contacts the Yi
  cloud or any other Internet service.
- The camera and broker passwords are stored by Gladys in `secret` fields and
  are never written to the logs. A broker address is logged without its
  credentials.
- The MQTT settings read from a camera contain the broker password: only the
  topic names and messages are kept, the rest is dropped on the spot.
- Snapshots are kept in memory (the last one per camera, for the dashboard)
  and sent to Gladys; nothing is written to disk except `/data/cameras.json`
  (camera id, name, model, firmware, presets — no image, no password).

## Good practices for users

- Protect the yi-hack web interface with a user name and a password, and give
  them to the integration.
- Keep the cameras on a network that is not reachable from the Internet: the
  yi-hack web interface is plain HTTP.
- Give the integration an MQTT account limited to reading the camera topics.
- Keep Gladys, the integration and the yi-hack firmware up to date.
