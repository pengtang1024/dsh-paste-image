# Politique de sécurité

## Versions prises en charge

| Version | Prise en charge                                      |
| ------- | ---------------------------------------------------- |
| 0.2.x   | Oui — ligne de publication actuelle                  |
| 0.1.x   | Non — veuillez passer à 0.2.x, qui succède à 0.1.x   |

Le plugin n'a pas encore publié de version 1.0 ; les correctifs de sécurité sont donc publiés dans une nouvelle version corrective de la branche mineure actuelle, et non rétroportés vers des lignes de versions antérieures.

## Signaler une vulnérabilité

Veuillez signaler de manière privée. Utilisez le signalement privé de vulnérabilité de GitHub : ouvrez l'onglet **Security** du dépôt et sélectionnez **Report a vulnerability**. Si cette procédure n'est pas disponible, contactez le mainteneur sur GitHub [@pengtang1024](https://github.com/pengtang1024) pour obtenir un canal privé — ne divulguez pas les détails d'exploitation dans une issue publique.

Un bon rapport doit contenir :

- La version de DSH, ainsi que la méthode d'installation du plugin.
- Le système d'exploitation et la session de bureau.
- Les formats ou décodeurs concernés (XPM, BMP, détection, chemin de réinjection).
- Un matériel de reproduction minimal : le fichier ou les octets exacts, ainsi que les étapes de reproduction.
- La sortie de la Console au niveau Verbose, incluant toutes les lignes `[dsh-paste-image]`.

Nous confirmerons la réception des rapports dans la mesure du possible ; une fois le rapport confirmé, le correctif sera publié dans une version corrective ; sauf préférence contraire de votre part, nous vous remercierons dans les notes de publication.

## Périmètre

`dsh-paste-image` s'exécute entièrement dans le processus de rendu de DSH. Il n'accède pas au réseau, n'a pas de processus en arrière-plan, n'interroge pas le presse-papiers en continu et ne modifie pas le code hôte de DSH. Toute son activité consiste à : lire des fichiers à partir des événements `paste` ou `drop`, les décoder localement, les réencoder en PNG, puis distribuer un événement `drop` synthétique dans la même fenêtre.

Dans le périmètre :

- Les plantages, blocages ou épuisements de mémoire provoqués par des fichiers XPM ou BMP spécialement conçus.
- Les défauts du parseur produisant des pixels erronés et pouvant induire l'utilisateur en erreur.
- Le contournement des limites documentées (8 fichiers par événement, 4096 px pour le plus grand côté de l'image après conversion).
- Les moyens permettant au plugin de lire ou de transmettre des données allant au-delà des fichiers collés ou déposés.

Hors périmètre :

- Les vulnérabilités de DSH lui-même, d'Electron/Chromium ou du système d'exploitation.
- Les attaques qui nécessitent déjà le contrôle du processus de rendu ou la capacité d'installer un plugin ; ce code dispose de toute façon des pleins droits de la page.
- Les rapports relevant de l'ingénierie sociale, ainsi que les dénis de service causés par des fichiers très volumineux mais ordinaires, que le navigateur lui-même ne peut pas traiter.

## Notes de conception

- Le plugin ne lit des octets que dans `clipboardData.files` ou `dataTransfer.files` de l'événement.
- Le décodage utilise les codecs intégrés au navigateur, ainsi que deux petits parseurs locaux ; aucune donnée n'est envoyée à l'extérieur.
- Les fichiers convertis sont de nouveaux objets `File` en mémoire. Rien n'est écrit sur le disque et rien ne subsiste après le déchargement de la page.
- Aucune dépendance d'exécution tierce.
