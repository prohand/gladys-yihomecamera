# Caméras Yi Home

Utilisez vos caméras Yi Home dans Gladys : image en direct, détection de
mouvement, mode privé, vision nocturne, motorisation, dans les scènes et sur le
tableau de bord. Tout reste sur votre réseau local : pas de compte Yi, pas de
cloud.

## Avant de commencer : le firmware yi-hack

Le firmware d'origine des caméras Yi Home n'offre **aucun accès local** : tout
passe par le cloud Yi et son application, que personne d'autre ne peut utiliser.
Cette intégration fonctionne avec les caméras équipées du firmware libre
**yi-hack**, qui ajoute un petit serveur web à la caméra :

| Votre caméra                                                        | Firmware                                                                   |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Modèles récents (Yi 1080p Home/Dome/Outdoor 2020+, Kami…)           | [yi-hack-Allwinner-v2](https://github.com/roleoroleo/yi-hack-Allwinner-v2) |
| Modèles Allwinner (2019–2020)                                       | [yi-hack-Allwinner](https://github.com/roleoroleo/yi-hack-Allwinner)       |
| Modèles MStar (Yi Home 1080p 2018–2019, Yi Dome 1080p…)             | [yi-hack-MStar](https://github.com/roleoroleo/yi-hack-MStar)               |
| Anciens modèles HiSilicon (Yi Home 720p/1080p, Yi Dome, Yi Outdoor) | [yi-hack-v5](https://github.com/alienatedsec/yi-hack-v5)                   |

Chaque projet explique comment trouver votre modèle et installer le firmware
(une carte microSD suffit, rien à ouvrir). Ensuite, pour chaque caméra :

1. Donnez-lui une **adresse IP fixe** (une réservation DHCP dans votre box).
2. Ouvrez son interface web (`http://<adresse de la caméra>`) et vérifiez
   qu'elle fonctionne.
3. Conseillé : dans **Configuration → Système**, mettez un nom d'utilisateur et
   un mot de passe sur l'interface web.
4. Pour la détection de mouvement sans MQTT : dans **Réglages caméra**, activez
   **Enregistrer sur mouvement** (« Save video on motion »).

## Configuration

Dans Gladys : **Intégrations → Yi Home Cameras → Configuration**.

| Champ                            | Quoi mettre                                                                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adresses des caméras             | L'adresse IP de chaque caméra, séparées par des virgules : `192.168.1.20, 192.168.1.21`. Ajoutez `:port` si l'interface web n'est pas sur le port 80.      |
| Nom d'utilisateur / Mot de passe | Ceux de l'interface web yi-hack, si vous en avez mis. Les mêmes pour toutes les caméras.                                                                   |
| Intervalle de rafraîchissement   | Fréquence de lecture de l'état des caméras (30 s par défaut).                                                                                              |
| Intervalle des images            | Fréquence d'envoi d'une nouvelle image à Gladys (60 s par défaut, 10 s minimum). `0` n'en envoie aucune : le tableau de bord en demande une à l'ouverture. |
| Résolution des images            | Basse (640×360, légère) ou Haute (1080p). Une image haute trop lourde pour Gladys est envoyée en basse automatiquement.                                    |
| Broker MQTT                      | Facultatif, pour les événements en temps réel (voir plus bas). Exemple : `mqtt://192.168.1.10:1883`.                                                       |
| Utilisateur / mot de passe MQTT  | Ceux de votre broker, si besoin.                                                                                                                           |
| Durée du mouvement               | Combien de temps le détecteur de mouvement reste actif après une détection quand la caméra ne dit pas quand il se termine (60 s par défaut).               |

Enregistrez, puis cliquez sur **Tester la connexion** : la réponse liste chaque
caméra trouvée, son modèle, son firmware, ses positions enregistrées, et comment
son mouvement est détecté.

Ouvrez ensuite l'onglet **Découverte** et ajoutez les caméras.

## Ce que donne chaque caméra dans Gladys

| Fonctionnalité         | Description                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Image                  | La dernière image ; le tableau de bord en demande une fraîche à l'ouverture.                                                              |
| Caméra allumée         | Allume ou éteint la caméra (mode vie privée de yi-hack). Éteinte, Gladys n'affiche plus son image.                                        |
| Mouvement              | 1 quand un mouvement est détecté, retour à 0 à la fin.                                                                                    |
| LED d'état             | La LED à l'avant de la caméra.                                                                                                            |
| Vision nocturne (IR)   | Les éclairages infrarouges.                                                                                                               |
| Signal Wi-Fi           | Qualité du Wi-Fi en % (absent sur une caméra filaire).                                                                                    |
| Déplacement / Position | **Modèles motorisés uniquement** : tourner à gauche, à droite, en haut, en bas, et aller à une position enregistrée dans l'interface web. |

Les noms des fonctionnalités sont créés en anglais (« Camera on », « Motion »…) :
vous pouvez les renommer dans Gladys.

## Détection de mouvement : deux façons

**Sans MQTT (par défaut).** L'intégration regarde les enregistrements de la
caméra toutes les 10 secondes : une nouvelle vidéo signifie un mouvement. Il faut
que **Enregistrer sur mouvement** soit activé dans les réglages de la caméra, et
il peut y avoir jusqu'à une minute de retard (la caméra enregistre ses vidéos
par minute).

**Avec MQTT (conseillé).** Le mouvement arrive en une seconde environ, et avec
lui ce que l'IA de la caméra a reconnu (personne, véhicule, animal — sur les
modèles qui l'ont), les bruits forts et les pleurs de bébé.

1. Il vous faut un broker MQTT (par exemple celui de Gladys, ou Mosquitto).
2. Dans l'interface web yi-hack, page **MQTT** : indiquez le broker, activez
   MQTT, et donnez **à chaque caméra son propre préfixe MQTT** (`garage`,
   `jardin`…). Avec le même préfixe, deux caméras ne peuvent pas être
   distinguées.
3. Dans la configuration de l'intégration, indiquez le même broker.
4. Cliquez sur **Tester la connexion** : chaque caméra indique
   `mouvement : MQTT, en temps réel`.

Les topics et messages sont lus sur chaque caméra : si vous les avez renommés
dans yi-hack, il n'y a rien à changer ici.

## Scènes

**Déclencheurs**

- **Une caméra détecte un mouvement** — filtre par caméra et par détection
  (mouvement, personne, véhicule, animal). Variables : nom de la caméra,
  détection.
- **Une caméra entend un son** — bruit fort ou pleurs de bébé (MQTT).
  Variables : nom de la caméra, son.
- **Une caméra ne répond plus** / **Une caméra répond de nouveau** —
  débranchée, hors de portée du Wi-Fi… Un redémarrage demandé depuis Gladys ne
  les déclenche pas.

**Actions**

- **Prendre une photo** — envoie une image fraîche à Gladys (pratique juste
  avant une notification). Sortie : image prise.
- **Tourner une caméra vers une position** — modèles motorisés, position 0 à 7.
  Sortie : caméra tournée.
- **Régler la sensibilité au mouvement** — basse, moyenne, haute. Sortie :
  appliquée.
- **Redémarrer une caméra**. Sortie : redémarrage envoyé.

Les fonctionnalités **Caméra allumée**, **LED d'état** et **Vision nocturne**
se pilotent aussi avec l'action standard « Contrôler un appareil ».

## Tableau de bord

- Widget **Caméra Yi** : choisissez une caméra dans ses réglages. Il affiche la
  dernière image, la connexion, marche/arrêt, le dernier mouvement, le signal
  Wi-Fi, la place libre sur la carte SD, et des boutons : photo,
  allumer/éteindre, aller à une position (motorisées), redémarrer.
- Widget **Caméras Yi** : toutes les caméras d'un coup d'œil (en ligne,
  éteinte, mouvement) et un bouton pour actualiser.

Le widget caméra standard de Gladys fonctionne aussi avec ces caméras.

## Boutons de l'écran de configuration

- **Tester la connexion** — relit toutes les caméras et dit ce qui a été trouvé.
- **Identifier une caméra** — sa LED clignote trois fois : pratique quand
  plusieurs caméras se ressemblent.
- **Redémarrer une caméra**.

## En cas de problème

| Message                                          | Que faire                                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| injoignable / pas de réponse à temps             | Vérifiez l'adresse, que la caméra est alimentée et sur le même réseau que Gladys.                  |
| nom d'utilisateur ou mot de passe incorrect      | Retapez le nom d'utilisateur et le mot de passe de l'interface web yi-hack.                        |
| ce n'est pas une caméra avec le firmware yi-hack | L'adresse répond, mais ce n'est pas yi-hack : mauvaise adresse, ou firmware d'origine.             |
| mouvement : non détecté                          | Activez **Enregistrer sur mouvement** sur la caméra, ou configurez MQTT.                           |
| préfixe MQTT déjà pris par une autre caméra      | Donnez à chaque caméra son propre préfixe dans la page MQTT de yi-hack.                            |
| Broker MQTT : non connecté                       | Vérifiez l'adresse du broker, son utilisateur et son mot de passe, et que le port 1883 est ouvert. |

Pour plus de détails, regardez les journaux de l'intégration dans **Paramètres
→ Système → Intégrations**.

## Vie privée

L'intégration ne contacte jamais le cloud Yi ni aucun service Internet. Les
images restent entre les caméras et Gladys. Les mots de passe ne sont jamais
écrits dans les journaux.
