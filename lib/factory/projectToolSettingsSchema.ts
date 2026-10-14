// lib/factory/projectToolSettingsSchema.ts
// 툴킷(game-toolkit)의 schemas/project-settings.schema.json · examples/project-settings.one-tiny-frame.json 의 사본.
// 감독 프로그램이 툴킷 스키마의 지문(schemaHash)을 보고하면 이 사본과 다른지 비교해 경고만 한다(툴킷 코드는 건드리지 않는다).
// 툴킷 스키마가 바뀌면 이 파일을 같은 내용으로 갱신한다.
export const PROJECT_SETTINGS_SCHEMA: Record<string, unknown> = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "project-settings.schema.json",
  "title": "pixel-art 프로젝트 설정",
  "description": "pixel-art 의 settings 인자로 읽는 프로젝트 설정. 원본은 나중에 홈페이지(통제실) 설정이 되고, 툴킷은 이 JSON 을 읽기만 한다. 값이 없으면 기본값을 쓴다.",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "$schema": {
      "type": "string"
    },
    "version": {
      "const": 1
    },
    "methods": {
      "description": "결과 종류별 방식. allowed 를 주면 그 방식만 쓸 수 있고, default 는 요청에 method 가 없을 때 쓴다(요청 > 프로젝트 설정 > 표의 기본).",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "image-prop": {
          "$ref": "#/$defs/kindMethods/image-prop"
        },
        "image-scene": {
          "$ref": "#/$defs/kindMethods/image-scene"
        },
        "motion-game": {
          "$ref": "#/$defs/kindMethods/motion-game"
        },
        "motion-clip": {
          "$ref": "#/$defs/kindMethods/motion-clip"
        }
      }
    },
    "results": {
      "description": "이 프로젝트에서 만들 수 있는 결과 종류.",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "allowed_kinds": {
          "type": "array",
          "items": {
            "enum": [
              "image-prop",
              "image-scene",
              "motion-game",
              "motion-clip"
            ]
          },
          "uniqueItems": true
        },
        "default_kind": {
          "enum": [
            "image-prop",
            "image-scene",
            "motion-game",
            "motion-clip"
          ]
        }
      }
    },
    "spec": {
      "description": "규격.",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "cell_size": {
          "description": "도트 칸 크기(한 변 px). 기본 32",
          "type": "integer",
          "minimum": 8,
          "maximum": 256
        },
        "size_group": {
          "description": "크기 그룹 이름(메모, 예: small|medium|large)",
          "type": "string",
          "maxLength": 40
        },
        "canvas": {
          "description": "장면 캔버스(한 변 px). 기본 1024",
          "type": "integer",
          "minimum": 64,
          "maximum": 1254
        }
      }
    },
    "style": {
      "description": "스타일.",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "outline_color": {
          "description": "기준 외곽선 색 #RRGGBB (pixel-slice 의 outline_color)",
          "type": "string",
          "pattern": "^#[0-9A-Fa-f]{6}$"
        },
        "max_colors": {
          "description": "최대 색 수. 기본 16",
          "type": "integer",
          "minimum": 2,
          "maximum": 256
        },
        "preset": {
          "description": "styles/ 폴더의 스타일 프리셋 이름(예: ssagi). codex 방식에서 pixel-codex style 로 넘김",
          "type": "string",
          "maxLength": 40
        },
        "notes": {
          "description": "스타일 메모(사람용)",
          "type": "string",
          "maxLength": 1000
        }
      }
    },
    "motion": {
      "description": "모션.",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "preset": {
          "enum": [
            "walk",
            "idle",
            "bounce",
            "sway"
          ]
        },
        "frames": {
          "description": "프레임 수(요청의 frames 가 이김)",
          "type": "integer",
          "minimum": 2,
          "maximum": 64
        },
        "fps": {
          "description": "움짤 속도(초당 프레임). 기본 8",
          "type": "integer",
          "minimum": 1,
          "maximum": 30
        },
        "loop": {
          "description": "움짤 반복 방식. 기본 pingpong",
          "enum": [
            "pingpong",
            "forward"
          ]
        },
        "pixel_motion": {
          "description": "method=claude 의 pixel-motion 값. 프리셋이 쓰지 않는 값은 무시한다.",
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "stride": {
              "type": "integer",
              "minimum": 0,
              "maximum": 32
            },
            "lift": {
              "type": "integer",
              "minimum": 0,
              "maximum": 32
            },
            "bob": {
              "type": "integer",
              "minimum": 0,
              "maximum": 32
            },
            "sway": {
              "type": "integer",
              "minimum": 0,
              "maximum": 32
            },
            "facing": {
              "enum": [
                "right",
                "left"
              ]
            }
          }
        }
      }
    },
    "cost": {
      "description": "비용 한도. PixelLab 호출(generation) 수 기준. 넘으면 시작 전에 needs_confirmation 오류로 멈춘다.",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "pixellab_per_job": {
          "type": "integer",
          "minimum": 0
        },
        "pixellab_per_month": {
          "type": "integer",
          "minimum": 0
        }
      }
    },
    "references": {
      "description": "참고 그림. 요청에 고른 그림(①) 다음에 approved 에서 ②같은 대상 이름 ③같은 결과 종류 순으로 채운다(전체 최대 4장).",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "auto_max": {
          "description": "자동으로 붙일 최대 장수(0~4). 기본 4",
          "type": "integer",
          "minimum": 0,
          "maximum": 4
        },
        "approved": {
          "description": "승인된 그림 목록. project 가 있으면 같은 프로젝트 요청에만 쓴다. path 는 앱 폴더 안 경로 또는 URL.",
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "path"
            ],
            "properties": {
              "path": {
                "type": "string"
              },
              "subject": {
                "type": "string"
              },
              "kind": {
                "enum": [
                  "image-prop",
                  "image-scene",
                  "motion-game",
                  "motion-clip"
                ]
              },
              "project": {
                "type": "string"
              }
            }
          }
        }
      }
    },
    "aliases": {
      "description": "대상 이름 별칭. { 대표 이름: [별칭, …] } — 요청의 subject 가 별칭이면 대표 이름으로 합친다.",
      "type": "object",
      "additionalProperties": {
        "type": "array",
        "items": {
          "type": "string"
        }
      }
    }
  },
  "$defs": {
    "kindMethods": {
      "image-prop": {
        "$ref": "#/$defs/methodsFor"
      },
      "image-scene": {
        "$ref": "#/$defs/methodsFor"
      },
      "motion-game": {
        "$ref": "#/$defs/methodsFor"
      },
      "motion-clip": {
        "$ref": "#/$defs/methodsFor"
      }
    },
    "methodsFor": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "allowed": {
          "type": "array",
          "items": {
            "enum": [
              "codex",
              "pixellab",
              "claude",
              "manual"
            ]
          },
          "uniqueItems": true
        },
        "default": {
          "enum": [
            "codex",
            "pixellab",
            "claude",
            "manual"
          ]
        }
      }
    }
  }
};

/** 처음 값: one-tiny-frame(하찮은 한 컷). 툴킷 예시 파일 내용 */
export const ONE_TINY_FRAME_SETTINGS: Record<string, unknown> = {
  "version": 1,
  "methods": {
    "image-prop": {
      "allowed": [
        "codex",
        "claude"
      ],
      "default": "codex"
    },
    "image-scene": {
      "allowed": [
        "codex"
      ],
      "default": "codex"
    },
    "motion-game": {
      "allowed": [
        "claude",
        "codex"
      ],
      "default": "claude"
    },
    "motion-clip": {
      "allowed": [
        "manual",
        "codex"
      ],
      "default": "manual"
    }
  },
  "results": {
    "allowed_kinds": [
      "image-prop",
      "image-scene",
      "motion-game",
      "motion-clip"
    ],
    "default_kind": "image-prop"
  },
  "spec": {
    "cell_size": 32,
    "size_group": "small",
    "canvas": 1024
  },
  "style": {
    "outline_color": "#3a2820",
    "max_colors": 16,
    "preset": "ssagi",
    "notes": "둥근 몸, 작은 발, 굵은 어두운 외곽선"
  },
  "motion": {
    "preset": "walk",
    "frames": 8,
    "fps": 8,
    "loop": "pingpong",
    "pixel_motion": {
      "stride": 7,
      "lift": 3,
      "bob": 2,
      "sway": 1,
      "facing": "right"
    }
  },
  "cost": {
    "pixellab_per_job": 3,
    "pixellab_per_month": 30
  },
  "references": {
    "auto_max": 3,
    "approved": [
      {
        "path": "style-anchors/ssagi/side.png",
        "subject": "싹이",
        "kind": "motion-game",
        "project": "one-tiny-frame"
      }
    ]
  },
  "aliases": {
    "싹이": [
      "감자",
      "ssagi"
    ]
  }
};

/** 새싹 허브(saessak-hub) 처음 값: 게임 코드에서 확인한 값만. 값마다 출처는 주석(저장소 ~/dev/factory/saessak-hub, game-toolkit)
 *  넣지 않은 것(코드에서 확인 못 함): spec.canvas(장면 캔버스) · motion(프리셋·프레임·fps·pixel_motion) · references.approved(승인 그림은 스튜디오에서 승인하면 생김) */
export const SAESSAK_HUB_APP_SLUG = "saessak-hub";
export const SAESSAK_HUB_WHO = "정비(새싹 허브 코드 기준)";
export const SAESSAK_HUB_NOTE = "처음 값(허브 게임 코드 기준)";
export const SAESSAK_HUB_SETTINGS: Record<string, unknown> = {
  "version": 1,
  // 방식: game-toolkit toolkit/pixelart.py KINDS(줄 23~28)의 방식 목록·첫 번째 기본값. PixelLab 허용은 켬(motion-clip 은 툴킷이 pixellab 을 안 줌)
  "methods": {
    "image-prop": { "allowed": ["codex", "pixellab", "claude"], "default": "codex" },
    "image-scene": { "allowed": ["codex", "pixellab"], "default": "codex" },
    "motion-game": { "allowed": ["claude", "pixellab", "codex"], "default": "claude" },
    "motion-clip": { "allowed": ["manual", "codex"], "default": "manual" }
  },
  "results": {
    "allowed_kinds": ["image-prop", "image-scene", "motion-game", "motion-clip"],
    "default_kind": "image-prop"
  },
  // 규격: 한 칸 32px = saessak-hub lib/game/config.dart:13 `Cfg.tile = 32`. 크기 그룹 = lib/tool/check_rules.dart:46~52 sizeGroups 이름
  "spec": {
    "cell_size": 32,
    "size_group": "길가 건물·나무·마당 소품·세트 소품·연구/교육/휴게실"
  },
  // 스타일: 외곽선 58,40,32 = check_rules.dart:10 · 최대 색 수 56 = check_rules.dart:28(작은 그림은 32, 줄 32) · 프리셋 hub = game-toolkit styles/hub/preset.json
  "style": {
    "outline_color": "#3A2820",
    "max_colors": 56,
    "preset": "hub",
    "notes": "소품은 투명 배경(마진 20% 이하·잘림 없음, check_rules.dart:35·38). 정면에서 약간 위 시점, 진한 갈색 외곽선 1칸 두께, 색 2~3단 음영·그라데이션 없음. 작은 그림은 32색 이하. 자세한 규칙: styles/hub/preset.json"
  },
  // 비용 한도: 하찮은 한 컷(one-tiny-frame)과 같은 값
  "cost": {
    "pixellab_per_job": 3,
    "pixellab_per_month": 30
  },
  // 별칭: 허브 게임에는 이름이 정해진 캐릭터가 없고 직원 이름은 실행 때 무작위(config.dart:169 이름 목록). 그림 폴더 이름(assets/sprites/staff, customer)만 묶음
  "aliases": {
    "직원": ["staff", "staff_walk"],
    "손님": ["customer", "cust"]
  }
};
