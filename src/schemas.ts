// GENERATED from openapi.json — do not edit by hand.
//
// Per-route invocation contracts published inside the x402 402 challenge as
// `accepts[].outputSchema`. `input` tells an agent how to build the request
// (method, query/path params, JSON body fields); `output` is the JSON Schema of
// the 200 body it gets back once payment settles.
//
// Deriving these from `openapi.json` keeps the runtime challenge — which the
// x402scan discovery spec treats as authoritative — from ever contradicting the
// published spec. Regenerate whenever a paid route's parameters or response
// schema change.
//
// Keys match the paywall route map in `server.ts` exactly (`"<METHOD> <path>"`,
// with `:param` for path segments).

import type { RouteSchema } from "./payments.js";

export const ROUTE_SCHEMAS: Record<string, RouteSchema> = {
  "GET /receipt/:tx": {
    "input": {
      "type": "http",
      "method": "GET",
      "queryParams": {
        "network": {
          "type": "string",
          "enum": [
            "base",
            "base-sepolia",
            "solana",
            "solana-devnet"
          ]
        },
        "resource": {
          "type": "string",
          "description": "The x402 resource this payment bought"
        },
        "merchant": {
          "type": "string"
        },
        "label": {
          "type": "string"
        },
        "category": {
          "type": "string"
        }
      },
      "pathParams": {
        "tx": {
          "type": "string",
          "x-required": true
        }
      }
    },
    "output": {
      "type": "object",
      "required": [
        "receipt"
      ],
      "properties": {
        "receipt": {
          "type": "object",
          "properties": {
            "payload": {
              "type": "object",
              "properties": {
                "transaction": {
                  "type": "string"
                },
                "rail": {
                  "type": "string",
                  "enum": [
                    "evm",
                    "solana"
                  ]
                },
                "network": {
                  "type": "string"
                },
                "status": {
                  "type": "string",
                  "enum": [
                    "success",
                    "failed"
                  ]
                },
                "timestamp": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "format": "date-time"
                },
                "payer": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "payee": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "amount": {
                  "type": [
                    "number",
                    "null"
                  ]
                },
                "amountRaw": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "asset": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "symbol": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "feeNative": {
                  "type": [
                    "number",
                    "null"
                  ]
                },
                "block": {
                  "type": [
                    "number",
                    "null"
                  ]
                },
                "explorerUrl": {
                  "type": "string",
                  "format": "uri"
                },
                "transfers": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "from": {
                        "type": "string"
                      },
                      "to": {
                        "type": "string"
                      },
                      "amount": {
                        "type": "number"
                      },
                      "amountRaw": {
                        "type": "string"
                      },
                      "asset": {
                        "type": "string"
                      },
                      "symbol": {
                        "type": "string"
                      },
                      "decimals": {
                        "type": "integer"
                      }
                    }
                  }
                },
                "metadata": {
                  "type": "object",
                  "description": "What the agent knows and the chain doesn't.",
                  "properties": {
                    "resource": {
                      "type": "string"
                    },
                    "merchant": {
                      "type": "string"
                    },
                    "label": {
                      "type": "string"
                    },
                    "category": {
                      "type": "string"
                    }
                  },
                  "additionalProperties": true
                },
                "resolvedAt": {
                  "type": "string",
                  "format": "date-time"
                },
                "updatedAt": {
                  "type": "string",
                  "format": "date-time"
                }
              }
            },
            "signature": {
              "type": "string"
            },
            "algorithm": {
              "type": "string",
              "const": "HMAC-SHA256"
            }
          }
        },
        "paidWith": {
          "type": "object",
          "properties": {
            "success": {
              "type": "boolean"
            },
            "rail": {
              "type": "string",
              "enum": [
                "evm",
                "solana"
              ]
            },
            "network": {
              "type": "string"
            },
            "transaction": {
              "type": "string"
            },
            "payer": {
              "type": "string"
            },
            "amount": {
              "type": "string"
            },
            "asset": {
              "type": "string"
            },
            "resource": {
              "type": "string"
            }
          }
        }
      }
    }
  },
  "GET /export": {
    "input": {
      "type": "http",
      "method": "GET",
      "queryParams": {
        "rail": {
          "type": "string",
          "enum": [
            "evm",
            "solana"
          ]
        },
        "network": {
          "type": "string"
        },
        "payer": {
          "type": "string"
        },
        "payee": {
          "type": "string"
        },
        "merchant": {
          "type": "string"
        },
        "category": {
          "type": "string"
        },
        "since": {
          "type": "string",
          "description": "ISO date/datetime, inclusive"
        },
        "until": {
          "type": "string",
          "description": "ISO date/datetime, exclusive"
        }
      }
    },
    "output": {
      "type": "object",
      "required": [
        "export",
        "csv"
      ],
      "properties": {
        "export": {
          "type": "object",
          "properties": {
            "payload": {
              "type": "object",
              "properties": {
                "generatedAt": {
                  "type": "string",
                  "format": "date-time"
                },
                "filter": {
                  "type": "object"
                },
                "summary": {
                  "type": "object",
                  "properties": {
                    "count": {
                      "type": "integer"
                    },
                    "totalUsd": {
                      "type": "number",
                      "description": "Successful USDC legs only"
                    },
                    "failedCount": {
                      "type": "integer"
                    },
                    "firstAt": {
                      "type": [
                        "string",
                        "null"
                      ]
                    },
                    "lastAt": {
                      "type": [
                        "string",
                        "null"
                      ]
                    },
                    "byRail": {
                      "type": "object",
                      "additionalProperties": {
                        "type": "object",
                        "properties": {
                          "count": {
                            "type": "integer"
                          },
                          "totalUsd": {
                            "type": "number"
                          }
                        }
                      }
                    },
                    "byMerchant": {
                      "type": "object",
                      "additionalProperties": {
                        "type": "object",
                        "properties": {
                          "count": {
                            "type": "integer"
                          },
                          "totalUsd": {
                            "type": "number"
                          }
                        }
                      }
                    }
                  }
                },
                "records": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "transaction": {
                        "type": "string"
                      },
                      "rail": {
                        "type": "string",
                        "enum": [
                          "evm",
                          "solana"
                        ]
                      },
                      "network": {
                        "type": "string"
                      },
                      "status": {
                        "type": "string",
                        "enum": [
                          "success",
                          "failed"
                        ]
                      },
                      "timestamp": {
                        "type": [
                          "string",
                          "null"
                        ],
                        "format": "date-time"
                      },
                      "payer": {
                        "type": [
                          "string",
                          "null"
                        ]
                      },
                      "payee": {
                        "type": [
                          "string",
                          "null"
                        ]
                      },
                      "amount": {
                        "type": [
                          "number",
                          "null"
                        ]
                      },
                      "amountRaw": {
                        "type": [
                          "string",
                          "null"
                        ]
                      },
                      "asset": {
                        "type": [
                          "string",
                          "null"
                        ]
                      },
                      "symbol": {
                        "type": [
                          "string",
                          "null"
                        ]
                      },
                      "feeNative": {
                        "type": [
                          "number",
                          "null"
                        ]
                      },
                      "block": {
                        "type": [
                          "number",
                          "null"
                        ]
                      },
                      "explorerUrl": {
                        "type": "string",
                        "format": "uri"
                      },
                      "transfers": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "from": {
                              "type": "string"
                            },
                            "to": {
                              "type": "string"
                            },
                            "amount": {
                              "type": "number"
                            },
                            "amountRaw": {
                              "type": "string"
                            },
                            "asset": {
                              "type": "string"
                            },
                            "symbol": {
                              "type": "string"
                            },
                            "decimals": {
                              "type": "integer"
                            }
                          }
                        }
                      },
                      "metadata": {
                        "type": "object",
                        "description": "What the agent knows and the chain doesn't.",
                        "properties": {
                          "resource": {
                            "type": "string"
                          },
                          "merchant": {
                            "type": "string"
                          },
                          "label": {
                            "type": "string"
                          },
                          "category": {
                            "type": "string"
                          }
                        },
                        "additionalProperties": true
                      },
                      "resolvedAt": {
                        "type": "string",
                        "format": "date-time"
                      },
                      "updatedAt": {
                        "type": "string",
                        "format": "date-time"
                      }
                    }
                  }
                }
              }
            },
            "signature": {
              "type": "string"
            },
            "algorithm": {
              "type": "string",
              "const": "HMAC-SHA256"
            }
          }
        },
        "csv": {
          "type": "string"
        },
        "digest": {
          "type": "string"
        },
        "paidWith": {
          "type": "object",
          "properties": {
            "success": {
              "type": "boolean"
            },
            "rail": {
              "type": "string",
              "enum": [
                "evm",
                "solana"
              ]
            },
            "network": {
              "type": "string"
            },
            "transaction": {
              "type": "string"
            },
            "payer": {
              "type": "string"
            },
            "amount": {
              "type": "string"
            },
            "asset": {
              "type": "string"
            },
            "resource": {
              "type": "string"
            }
          }
        }
      }
    }
  },
};
