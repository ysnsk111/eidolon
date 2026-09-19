# Persona Package Format & Bundle Structure

## Directory Structure

```
completed_result/
└── persona_YYYYMMDD_HHMMSS/
    ├── manifest.json
    ├── persona.json
    ├── style.json
    ├── behavior.json
    ├── language_model.json
    ├── world.json
    ├── relationships.json
    ├── memory_seed.json
    ├── assets/
    │   ├── emoji.json
    │   └── stickers.json
    ├── evaluation/
    │   ├── report.json
    │   ├── report.html
    │   ├── metrics.json
    │   └── failures.json
    └── README.md
```

## Archive Bundle (`.eidolon`)

The package is zipped into a single distributable bundle: `persona_xxx.eidolon`.
It can be installed onto another machine using:
```bash
eidolon persona install /path/to/persona_xxx.eidolon
eidolon persona activate persona_xxx
```
