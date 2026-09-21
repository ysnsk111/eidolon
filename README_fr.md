# EIDOLON v1.2.1

<p align="center">
  <strong>Distillation de Personnalité, Relations Dynamiques L4 & Mémoire Biométrique</strong><br>
  <em>«Préserver l'expression. Reconstruire le contexte. Mesurer la fidélité. Simuler une présence authentique.»</em>
</p>

<p align="center">
  <a href="README.md"><strong>🇨🇳 简体中文</strong></a> •
  <a href="README_en.md"><strong>🇺🇸 English</strong></a> •
  <a href="README_zh-TW.md"><strong>🇭🇰/🇹🇼 繁體中文</strong></a> •
  <a href="README_ja.md"><strong>🇯🇵 日本語</strong></a> •
  <a href="README_ko.md"><strong>🇰🇷 한국어</strong></a> •
  <a href="README_ru.md"><strong>🇷🇺 Русский</strong></a> •
  <a href="README_fr.md"><strong>🇫🇷 Français</strong></a> •
  <a href="README_es.md"><strong>🇪🇸 Español</strong></a> •
  <a href="docs/human-simulation-algorithm.md"><strong>📐 Spécification de l'algorithme</strong></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Release-v1.2.1%20(Formal)-blue.svg" alt="Release: v1.2.1 (Formal)">
  <img src="https://img.shields.io/badge/License-GPL%20v3.0-blue.svg" alt="License: GPL-3.0">
  <img src="https://img.shields.io/badge/Node.js-24%20LTS-green.svg" alt="Node.js: 24 LTS">
  <img src="https://img.shields.io/badge/Go-1.22+-00ADD8.svg" alt="Go 1.22+">
  <img src="https://img.shields.io/badge/SQLite-Native%20ACID-003B57.svg" alt="SQLite: Native ACID">
  <img src="https://img.shields.io/badge/L4%20State-BSM%20Engine-ff69b4.svg" alt="L4 State: BSM Engine">
  <img src="https://img.shields.io/badge/Tests-38%20Passed-brightgreen.svg" alt="Tests: 38 Passed">
</p>

---

## Sommaire

- [1. Redéfinition du Projet](#1-redéfinition-du-projet)
- [2. Architecture & 7 Niveaux de Distillation](#2-architecture--7-niveaux-de-distillation)
- [3. Indice de Similarité de Distillation (DSI)](#3-indice-de-similarité-de-distillation-dsi)
- [4. Relations Dynamiques L4 & Simulation Humaine](#4-relations-dynamiques-l4--simulation-humaine)
- [5. Démarrage Rapide & Assistant de Configuration](#5-démarrage-rapide--assistant-de-configuration)
- [6. Référence des Commandes CLI](#6-référence-des-commandes-cli)
- [7. Licence](#7-licence)

---

## 1. Redéfinition du Projet

EIDOLON n'est pas un simple outil résumant des journaux de conversation dans un prompt système.

**Définition Officielle V1.2 :**
> **«Distiller des caractéristiques linguistiques, comportementales, rythmiques et contextuelles calculables à partir de conversations réelles, animées par un moteur d'émotions et de relations dynamiques L4, validées rigoureusement sur des bancs d'essai en double aveugle pour garantir la cohérence stylistique et la fidélité факtuelle d'un compagnon authentique.»**

---

## 2. Architecture & 7 Niveaux de Distillation

| Niveau | Module | Caractéristiques Analysées | Fichier Produit |
| :--- | :--- | :--- | :--- |
| **Layer 1** | Empreinte Linguistique | Fréquence du vocabulaire, ponctuation, longueur des phrases | `language_model.json` |
| **Layer 2** | Style Conditionnel | Probabilités bayésiennes conditionnelles $P(\text{style} \mid \text{contexte})$ | `style.json` |
| **Layer 3** | Arbre de Décision | Stratégies adaptatives (humour, empathie, analyse, questions en retour) | `behavior.json` |
| **Layer 4** | Rythme de Dialogue | Latence de réponse par taille de message, probabilité d'envois multiples | `rhythm.json` |
| **Layer 5** | Émoticônes & Médias | Autocollants, émojis et matrices de liaison sémantique contextuelle | `assets.json` |
| **Layer 6** | Modèle du Monde | Graphe relationnel, chronologie des événements, séparation stricte des données | `world.json` |
| **Layer 7** | Graine de Mémoire | L0 mémoire immédiate, L1 épisodique, L2 sémantique, L3 vision globale | `memory_seed.json` |

---

## 5. Démarrage Rapide & Assistant de Configuration

```bash
git clone https://github.com/ysnsk111/eidolon.git
cd eidolon
npm install
npm run build:server
npm start
```

Étapes de l'assistant interactif :
1. **Étape 0** : Sélection de la langue (Anglais par défaut, Français, Chinois, Japonais, Coréen, Russe, Espagnol).
2. **Étape 1** : Connexion à l'API LLM et validation simple-test.
3. **Étape 2** : Fichier de conversations et contexte supplémentaire du monde.
4. **Étape 3** : Configuration du token de bot Telegram et User ID.
5. **Étape 4** : Démarrage du démon et appairage sécurisé via `/start`.
6. **Étape 5** : Lancement de la distillation avec suivi en direct sur Telegram.

---

## 6. Référence des Commandes CLI

| Commande | Description |
| :--- | :--- |
| `eidolon init` | Lance l'assistant de configuration et initialise SQLite |
| `eidolon config [show\|set\|test]` | Affiche ou modifie la configuration, teste l'API |
| `eidolon distill <file> [options]` | Exécute la distillation complète sur 7 niveaux et l'évaluation |
| `eidolon evaluate <persona>` | Évalue une personnalité et calcule l'indice DSI |
| `eidolon validate <path>` | Vérifie la conformité JSON Schema d'un paquet `.eidolon` |
| `eidolon persona [list\|activate\|install\|verify]` | Gère les paquets de personnalité |
| `eidolon memory [status\|compact\|export]` | Analyse, compacte ou exporte la mémoire |
| `eidolon bot [token\|user\|status]` | Gère le bot Telegram et la liste blanche |
| `eidolon service [start\|stop\|restart\|status]` | Contrôle le service d'arrière-plan Go |
| `eidolon logs [-n lines]` | Affiche les journaux du service en direct |
| `eidolon status` | Résume l'état de tous les sous-systèmes |
| `eidolon clear [--mode all\|chat-memory]` | Nettoyage en 3 étapes : purge totale (all-clear) ou réinitialisation des conversations/mémoire |

---

## 7. Licence

Ce projet est distribué sous licence **GNU General Public License v3.0 (GPL-3.0)**.
