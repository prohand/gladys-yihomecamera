# Yi-Home-Kameras

Nutze deine Yi-Home-Kameras in Gladys: Live-Bild, Bewegungserkennung,
Privatmodus, Nachtsicht, Schwenken/Neigen, in Szenen und auf dem Dashboard.
Alles bleibt in deinem lokalen Netzwerk: kein Yi-Konto, keine Cloud.

## Bevor du beginnst: die yi-hack-Firmware

Die Original-Firmware der Yi-Home-Kameras bietet **keinen lokalen Zugriff**:
Alles läuft über die Yi-Cloud und ihre App, die sonst niemand nutzen kann. Diese
Integration funktioniert mit Kameras, auf denen die freie Firmware **yi-hack**
läuft, die der Kamera einen kleinen Webserver hinzufügt:

| Deine Kamera                                                       | Firmware                                                                   |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Neuere Modelle (Yi 1080p Home/Dome/Outdoor ab 2020, Kami…)         | [yi-hack-Allwinner-v2](https://github.com/roleoroleo/yi-hack-Allwinner-v2) |
| Allwinner-Modelle (2019–2020)                                      | [yi-hack-Allwinner](https://github.com/roleoroleo/yi-hack-Allwinner)       |
| MStar-Modelle (Yi Home 1080p 2018–2019, Yi Dome 1080p…)            | [yi-hack-MStar](https://github.com/roleoroleo/yi-hack-MStar)               |
| Ältere HiSilicon-Modelle (Yi Home 720p/1080p, Yi Dome, Yi Outdoor) | [yi-hack-v5](https://github.com/alienatedsec/yi-hack-v5)                   |

Jedes Projekt erklärt, wie du dein Modell findest und die Firmware installierst
(eine microSD-Karte genügt, nichts muss geöffnet werden). Danach für jede
Kamera:

1. Gib ihr eine **feste IP-Adresse** (eine DHCP-Reservierung im Router).
2. Öffne ihre Weboberfläche (`http://<Adresse der Kamera>`) und prüfe, ob sie
   funktioniert.
3. Empfohlen: Lege unter **Configuration → System** einen Benutzernamen und ein
   Passwort für die Weboberfläche fest.
4. Für die Bewegungserkennung ohne MQTT: Schalte unter **Camera settings** die
   Option **Save video on motion** ein.

## Konfiguration

In Gladys: **Integrationen → Yi Home Cameras → Konfiguration**.

| Feld                      | Was eintragen                                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adressen der Kameras      | Die IP-Adresse jeder Kamera, durch Kommas getrennt: `192.168.1.20, 192.168.1.21`. Füge `:Port` hinzu, wenn die Weboberfläche nicht auf Port 80 läuft. |
| Benutzername / Passwort   | Die der yi-hack-Weboberfläche, falls festgelegt. Dieselben für alle Kameras.                                                                          |
| Aktualisierungsintervall  | Wie oft der Zustand der Kameras gelesen wird (standardmäßig 30 s).                                                                                    |
| Bildintervall             | Wie oft ein neues Bild an Gladys gesendet wird (standardmäßig 60 s, mindestens 10 s). `0` sendet keines: Das Dashboard fragt beim Öffnen eines an.    |
| Bildauflösung             | Niedrig (640×360, leicht) oder Hoch (1080p). Ein für Gladys zu großes hohes Bild wird automatisch in niedriger Auflösung gesendet.                    |
| MQTT-Broker               | Optional, für Ereignisse in Echtzeit (siehe unten). Beispiel: `mqtt://192.168.1.10:1883`.                                                             |
| MQTT-Benutzer / -Passwort | Die deines Brokers, falls nötig.                                                                                                                      |
| Bewegungsdauer            | Wie lange der Bewegungsmelder nach einer Erkennung aktiv bleibt, wenn die Kamera das Ende nicht meldet (standardmäßig 60 s).                          |

Speichere und klicke dann auf **Verbindung testen**: Die Antwort listet jede
gefundene Kamera, ihr Modell, ihre Firmware, ihre gespeicherten Positionen und
wie ihre Bewegung erkannt wird.

Öffne dann den Reiter **Entdecken** und füge die Kameras hinzu.

## Was jede Kamera in Gladys bietet

| Funktion           | Beschreibung                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Bild               | Der letzte Schnappschuss; das Dashboard fragt beim Öffnen ein frisches an.                                                    |
| Kamera an          | Schaltet die Kamera ein oder aus (yi-hack-Privatmodus). Ausgeschaltet zeigt Gladys ihr Bild nicht mehr.                       |
| Bewegung           | 1, wenn eine Bewegung erkannt wird, am Ende wieder 0.                                                                         |
| Status-LED         | Die LED vorne an der Kamera.                                                                                                  |
| Nachtsicht (IR)    | Die Infrarotleuchten.                                                                                                         |
| WLAN-Signal        | WLAN-Qualität in % (fehlt bei einer Kamera mit Kabel).                                                                        |
| Bewegen / Position | **Nur schwenkbare Modelle**: links, rechts, hoch, runter drehen und eine in der Weboberfläche gespeicherte Position anfahren. |

Die Funktionen werden mit englischen Namen angelegt („Camera on“, „Motion“…):
Du kannst sie in Gladys umbenennen.

## Bewegungserkennung: zwei Wege

**Ohne MQTT (Standard).** Die Integration schaut alle 10 Sekunden in die
Aufnahmen der Kamera: Ein neuer Clip bedeutet eine Bewegung. Dafür muss **Save
video on motion** in den Kameraeinstellungen eingeschaltet sein, und es kann bis
zu einer Minute Verzögerung geben (die Kamera speichert ihre Clips minutenweise).

**Mit MQTT (empfohlen).** Die Bewegung kommt in etwa einer Sekunde an, und mit
ihr, was die KI der Kamera erkannt hat (Person, Fahrzeug, Tier — bei Modellen,
die sie haben), laute Geräusche und Babyweinen.

1. Du brauchst einen MQTT-Broker (zum Beispiel den von Gladys oder Mosquitto).
2. In der yi-hack-Weboberfläche, Seite **MQTT**: Trage den Broker ein, schalte
   MQTT ein und gib **jeder Kamera ein eigenes MQTT-Präfix** (`garage`,
   `garten`…). Mit demselben Präfix lassen sich zwei Kameras nicht
   unterscheiden.
3. Trage in der Konfiguration der Integration denselben Broker ein.
4. Klicke auf **Verbindung testen**: Jede Kamera meldet
   `Bewegung: MQTT, in Echtzeit`.

Topics und Meldungen werden von jeder Kamera gelesen: Wenn du sie in yi-hack
umbenannt hast, musst du hier nichts ändern.

## Szenen

**Auslöser**

- **Eine Kamera erkennt Bewegung** — Filter nach Kamera und Erkennung
  (Bewegung, Person, Fahrzeug, Tier). Variablen: Kameraname, Erkennung.
- **Eine Kamera hört ein Geräusch** — lautes Geräusch oder Babyweinen (MQTT).
  Variablen: Kameraname, Geräusch.
- **Eine Kamera antwortet nicht mehr** / **Eine Kamera antwortet wieder** —
  ausgesteckt, außer WLAN-Reichweite… Ein von Gladys angeforderter Neustart löst
  sie nicht aus.

**Aktionen**

- **Schnappschuss aufnehmen** — sendet ein frisches Bild an Gladys (praktisch
  direkt vor einer Benachrichtigung). Ausgabe: Bild aufgenommen.
- **Kamera auf eine Position drehen** — schwenkbare Modelle, Position 0 bis 7.
  Ausgabe: Kamera bewegt.
- **Bewegungsempfindlichkeit einstellen** — niedrig, mittel, hoch. Ausgabe:
  übernommen.
- **Kamera neu starten**. Ausgabe: Neustart gesendet.

Die Funktionen **Kamera an**, **Status-LED** und **Nachtsicht** lassen sich
auch mit der Standardaktion „Gerät steuern“ schalten.

## Dashboard

- Widget **Yi-Kamera**: Wähle in seinen Einstellungen eine Kamera. Es zeigt das
  letzte Bild, die Verbindung, an/aus, die letzte Bewegung, das WLAN-Signal, den
  freien Platz auf der SD-Karte und Tasten: Schnappschuss, ein-/ausschalten,
  Position anfahren (schwenkbare Modelle), Neustart.
- Widget **Yi-Kameras**: alle Kameras auf einen Blick (online, aus, Bewegung)
  und eine Taste zum Aktualisieren.

Das Standard-Kamera-Widget von Gladys funktioniert ebenfalls mit diesen Kameras.

## Tasten im Konfigurationsbildschirm

- **Verbindung testen** — liest alle Kameras neu und meldet, was gefunden wurde.
- **Kamera identifizieren** — ihre LED blinkt dreimal: praktisch, wenn mehrere
  Kameras gleich aussehen.
- **Kamera neu starten**.

## Fehlerbehebung

| Meldung                                           | Was tun                                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| nicht erreichbar / keine Antwort                  | Adresse prüfen, ob die Kamera Strom hat und im selben Netzwerk wie Gladys ist.           |
| falscher Benutzername oder falsches Passwort      | Benutzername und Passwort der yi-hack-Weboberfläche erneut eingeben.                     |
| keine Kamera mit der yi-hack-Firmware             | Die Adresse antwortet, aber es ist kein yi-hack: falsche Adresse oder Original-Firmware. |
| Bewegung: nicht erkannt                           | **Save video on motion** an der Kamera einschalten oder MQTT einrichten.                 |
| MQTT-Präfix schon von einer anderen Kamera belegt | Jeder Kamera auf der MQTT-Seite von yi-hack ein eigenes Präfix geben.                    |
| MQTT-Broker: nicht verbunden                      | Adresse, Benutzer und Passwort des Brokers prüfen und ob Port 1883 offen ist.            |

Mehr Details findest du in den Protokollen der Integration unter
**Einstellungen → System → Integrationen**.

## Datenschutz

Die Integration kontaktiert nie die Yi-Cloud oder einen anderen Internetdienst.
Die Bilder bleiben zwischen den Kameras und Gladys. Passwörter werden nie in die
Protokolle geschrieben.
