# Les Joies du Code TV

<img width="1922" height="1108" alt="image" src="https://github.com/user-attachments/assets/c198067f-63f0-4239-8376-9c0cf2bad649" />

Extension Chrome (Manifest V3) qui affiche un meme de [lesjoiesducode.fr](https://lesjoiesducode.fr) en plein écran sur une TV, avec refresh automatique toutes les 10 minutes.

Deux modes :
- **🎲 Random** — un meme aléatoire à chaque cycle, via `/random`
- **📅 Chrono** — du plus récent au plus vieux, via le flux RSS de la catégorie Memes (position sauvegardée entre les sessions)

## Pourquoi une extension et pas une page web ?

`lesjoiesducode.fr` envoie `X-Frame-Options: SAMEORIGIN` (pas d'iframe) et n'a pas d'header CORS (pas de `fetch` direct depuis une page web classique). Une extension Chrome a `host_permissions` qui contournent CORS — pas de proxy, pas de bricolage.

## Installation

### Option A — Depuis la dernière release (recommandé)

1. Télécharger le `.zip` depuis la page [Releases](../../releases/latest)
2. Le dézipper quelque part de stable
3. Ouvrir `chrome://extensions`
4. Activer **Mode développeur** (toggle en haut à droite)
5. Cliquer **Charger l'extension non empaquetée** et sélectionner le dossier
6. Cliquer sur l'icône dans la barre d'outils → ouvre l'affichage TV

### Option B — Depuis les sources

```bash
git clone https://github.com/Ayce45/joiesducode-tv-extension.git
cd joiesducode-tv-extension
```

Puis pareil que l'option A à partir de l'étape 3, en sélectionnant le dossier `extension/`.

## Utilisation

| Touche / bouton | Action |
|---|---|
| `N` ou `→` | Meme suivant |
| `F` ou `F11` | Toggle plein écran |
| `M` | Toggle mode Random ↔ Chrono |
| `R` | (chrono) Revenir au meme le plus récent |
| Clic icône extension | Ouvre l'affichage dans un nouvel onglet |

## Setup TV (mode kiosk)

Une fois l'extension installée, lancer Chrome au boot avec :

```bash
chrome --kiosk chrome-extension://EXTENSION_ID/tv.html
```

L'`EXTENSION_ID` s'affiche sur `chrome://extensions` sous le nom de l'extension. Sur une Chromebox / mini-PC dédié, ajouter ce lancement aux applications de démarrage.

## Permissions

Uniquement `https://lesjoiesducode.fr/*`. Pas de tracking, pas de tabs, pas de stockage externe — juste `localStorage` côté extension pour mémoriser le mode et la position chrono.

## Architecture

```
.
├── .github/
│   └── workflows/
│       └── release.yml        # Build & release automatique sur push de tag
├── extension/
│   ├── manifest.json          # Manifest V3, host_permissions, version
│   ├── background.js          # Service worker — ouvre tv.html au clic
│   ├── tv.html                # Layout (grid 9vh / 1fr / 5vh)
│   ├── tv.css                 # Styles TV — image full-fill avec object-fit: contain
│   ├── tv.js                  # Random + Chrono (parsing RSS), persistance localStorage
│   └── icon.png               # Icône extension
├── .gitignore
├── LICENSE                    # MIT
└── README.md
```

## Développement

L'extension est entièrement en vanilla JS — aucune dépendance, aucun build step. Modifier les fichiers dans `extension/`, recharger l'extension dans `chrome://extensions` (icône ↻ sur la carte), et ouvrir un nouvel onglet d'affichage.

## Release & versioning

Le workflow `.github/workflows/release.yml` produit automatiquement un `.zip` et crée une GitHub Release dès qu'un tag `v*` est poussé. Le tag doit correspondre à la version déclarée dans `extension/manifest.json`.

### Procédure de release

1. Bump la version dans `extension/manifest.json` (ex: `1.0.0` → `1.1.0`)
2. Commit : `git commit -am "Release v1.1.0"`
3. Tag et push :
   ```bash
   git tag v1.1.0
   git push origin main --tags
   ```
4. Le workflow se déclenche, vérifie que le tag matche le manifest, build le zip et l'attache à une nouvelle GitHub Release.

Tu peux aussi déclencher le workflow manuellement depuis l'onglet Actions (`workflow_dispatch`) en lui passant le tag à créer.

## Licence

[MIT](LICENSE)
