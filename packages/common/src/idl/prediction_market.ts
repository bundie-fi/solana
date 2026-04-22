/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/prediction_market.json`.
 */
export type PredictionMarket = {
  "address": "Y13kynHKA6nfgDtYReVTuPZEVki6NmY9dYDihQT8j7i",
  "metadata": {
    "name": "predictionMarket",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Yields.so Prediction Market Program - LS-LMSR markets with oracle-free resolution"
  },
  "instructions": [
    {
      "name": "buyShares",
      "docs": [
        "Buy YES or NO shares using LS-LMSR pricing"
      ],
      "discriminator": [
        40,
        239,
        138,
        154,
        8,
        37,
        106,
        108
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "strategy",
          "docs": [
            "The Strategy account this market predicts on. Pinocchio-owned, so",
            "we validate manually: discriminator + address equality to market.strategy,",
            "then check the authority field against the buyer."
          ]
        },
        {
          "name": "yesMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  121,
                  101,
                  115,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "noMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  110,
                  111,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "buyerCollateral",
          "docs": [
            "Buyer's collateral (USDC) token account"
          ],
          "writable": true
        },
        {
          "name": "buyerYesAta",
          "docs": [
            "Buyer's YES ATA — created if needed"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "buyer"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "yesMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "buyerNoAta",
          "docs": [
            "Buyer's NO ATA — created if needed"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "buyer"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "noMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "outcome",
          "type": {
            "defined": {
              "name": "outcome"
            }
          }
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createMarket",
      "docs": [
        "Create a new prediction market on a strategy's performance"
      ],
      "discriminator": [
        103,
        226,
        97,
        235,
        200,
        188,
        251,
        254
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "strategy"
              },
              {
                "kind": "arg",
                "path": "marketId"
              }
            ]
          }
        },
        {
          "name": "strategy"
        },
        {
          "name": "strategyB"
        },
        {
          "name": "collateralMint",
          "docs": [
            "USDC (or any SPL token) used as collateral"
          ]
        },
        {
          "name": "vault",
          "docs": [
            "Market vault — holds all collateral; authority is the market PDA"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "yesMint",
          "docs": [
            "YES outcome mint — market PDA is mint authority"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  121,
                  101,
                  115,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "noMint",
          "docs": [
            "NO outcome mint — market PDA is mint authority"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  110,
                  111,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "question",
          "type": "string"
        },
        {
          "name": "marketId",
          "type": "u64"
        },
        {
          "name": "marketType",
          "type": {
            "defined": {
              "name": "marketType"
            }
          }
        },
        {
          "name": "thresholdBps",
          "type": "u64"
        },
        {
          "name": "resolutionSlot",
          "type": "u64"
        },
        {
          "name": "initialSubsidy",
          "type": "u64"
        },
        {
          "name": "feeBps",
          "type": "u16"
        },
        {
          "name": "initialNavPerShare",
          "type": "u64"
        },
        {
          "name": "initialNavPerShareB",
          "type": "u64"
        }
      ]
    },
    {
      "name": "redeem",
      "docs": [
        "Redeem winning shares for payout"
      ],
      "discriminator": [
        184,
        12,
        86,
        149,
        70,
        196,
        97,
        225
      ],
      "accounts": [
        {
          "name": "redeemer",
          "writable": true,
          "signer": true
        },
        {
          "name": "market"
        },
        {
          "name": "winnerMint",
          "docs": [
            "The winning outcome mint (YES or NO — caller passes the correct one)"
          ],
          "writable": true
        },
        {
          "name": "redeemerShares",
          "docs": [
            "Redeemer's token account holding their winning shares (burned here)"
          ],
          "writable": true
        },
        {
          "name": "redeemerCollateral",
          "docs": [
            "Redeemer's collateral token account (receives USDC payout)"
          ],
          "writable": true
        },
        {
          "name": "vault",
          "docs": [
            "Market vault — source of payout; authority is the market PDA"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "resolve",
      "docs": [
        "Resolve market using strategy's on-chain NAV (oracle-free)"
      ],
      "discriminator": [
        246,
        150,
        236,
        206,
        108,
        63,
        58,
        10
      ],
      "accounts": [
        {
          "name": "resolver",
          "docs": [
            "Anyone can trigger resolution (permissionless)"
          ],
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "navOracle",
          "docs": [
            "NavOracle for strategy A.",
            "PDA seeds (strategy-token): [\"nav_oracle\", market.strategy].",
            "Validated in handler: discriminator + strategy key."
          ]
        },
        {
          "name": "navOracleB",
          "docs": [
            "NavOracle for strategy B (Relative markets only).",
            "Pass SystemProgram id for Absolute markets — ignored and not validated."
          ]
        }
      ],
      "args": []
    },
    {
      "name": "sellShares",
      "docs": [
        "Sell YES or NO shares back to the market"
      ],
      "discriminator": [
        184,
        164,
        169,
        16,
        231,
        158,
        199,
        196
      ],
      "accounts": [
        {
          "name": "seller",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "outcomeMint",
          "docs": [
            "The outcome mint being sold (YES or NO).",
            "Key verified against PDA in handler."
          ],
          "writable": true
        },
        {
          "name": "sellerShares",
          "docs": [
            "Seller's token account holding the shares to sell (burned here)"
          ],
          "writable": true
        },
        {
          "name": "sellerCollateral",
          "docs": [
            "Seller's collateral token account (receives payout)"
          ],
          "writable": true
        },
        {
          "name": "vault",
          "docs": [
            "Market vault — source of payout; authority is the market PDA"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "outcome",
          "type": {
            "defined": {
              "name": "outcome"
            }
          }
        },
        {
          "name": "shares",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "market",
      "discriminator": [
        219,
        190,
        213,
        55,
        0,
        227,
        198,
        154
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "questionTooLong",
      "msg": "Question too long (max 128 chars)"
    },
    {
      "code": 6001,
      "name": "marketNotActive",
      "msg": "Market is not active"
    },
    {
      "code": 6002,
      "name": "resolutionNotReached",
      "msg": "Market has not reached resolution slot"
    },
    {
      "code": 6003,
      "name": "alreadyResolved",
      "msg": "Market already resolved"
    },
    {
      "code": 6004,
      "name": "noOutcome",
      "msg": "No winning outcome set"
    },
    {
      "code": 6005,
      "name": "insufficientShares",
      "msg": "Insufficient shares to sell or redeem"
    },
    {
      "code": 6006,
      "name": "mathOverflow",
      "msg": "LS-LMSR calculation overflow"
    },
    {
      "code": 6007,
      "name": "invalidSubsidy",
      "msg": "Invalid initial subsidy amount"
    },
    {
      "code": 6008,
      "name": "invalidOracle",
      "msg": "NavOracle account has invalid discriminator or strategy mismatch"
    },
    {
      "code": 6009,
      "name": "insufficientSnapshots",
      "msg": "NavOracle has no snapshots yet; call update_nav first"
    },
    {
      "code": 6010,
      "name": "wrongOutcomeMint",
      "msg": "Wrong outcome token mint provided for redemption"
    },
    {
      "code": 6011,
      "name": "creatorCannotPredictOnOwnStrategy",
      "msg": "Strategy creator cannot take positions on their own strategy's market"
    },
    {
      "code": 6012,
      "name": "invalidStrategyAccount",
      "msg": "Strategy account has invalid discriminator or is too small"
    },
    {
      "code": 6013,
      "name": "wrongStrategyForMarket",
      "msg": "Strategy account does not match the market's strategy"
    }
  ],
  "types": [
    {
      "name": "market",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "strategy",
            "docs": [
              "Strategy this market predicts on"
            ],
            "type": "pubkey"
          },
          {
            "name": "strategyB",
            "docs": [
              "Second strategy for Relative market type matchups (None for Absolute)"
            ],
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "authority",
            "docs": [
              "Market creator"
            ],
            "type": "pubkey"
          },
          {
            "name": "subsidyProvider",
            "docs": [
              "Who provided initial liquidity subsidy"
            ],
            "type": "pubkey"
          },
          {
            "name": "question",
            "docs": [
              "Question text (max 128 bytes)"
            ],
            "type": "string"
          },
          {
            "name": "marketType",
            "docs": [
              "Market type (Absolute or Relative)"
            ],
            "type": {
              "defined": {
                "name": "marketType"
              }
            }
          },
          {
            "name": "marketId",
            "docs": [
              "Sequential market ID (used in PDA seeds)"
            ],
            "type": "u64"
          },
          {
            "name": "thresholdBps",
            "docs": [
              "APY threshold in basis points for resolution"
            ],
            "type": "u64"
          },
          {
            "name": "resolutionSlot",
            "docs": [
              "Slot at which market can be resolved"
            ],
            "type": "u64"
          },
          {
            "name": "yesShares",
            "docs": [
              "YES shares outstanding"
            ],
            "type": "u64"
          },
          {
            "name": "noShares",
            "docs": [
              "NO shares outstanding"
            ],
            "type": "u64"
          },
          {
            "name": "totalYesCost",
            "docs": [
              "Total cost basis paid for YES shares"
            ],
            "type": "u64"
          },
          {
            "name": "totalNoCost",
            "docs": [
              "Total cost basis paid for NO shares"
            ],
            "type": "u64"
          },
          {
            "name": "liquidityParam",
            "docs": [
              "LS-LMSR liquidity parameter (alpha)"
            ],
            "type": "u64"
          },
          {
            "name": "totalVolume",
            "docs": [
              "Total volume traded"
            ],
            "type": "u64"
          },
          {
            "name": "feeBps",
            "docs": [
              "Market fee in basis points (e.g., 100 = 1%)"
            ],
            "type": "u16"
          },
          {
            "name": "vault",
            "docs": [
              "Market vault for collateral"
            ],
            "type": "pubkey"
          },
          {
            "name": "collateralMint",
            "docs": [
              "Collateral token mint (e.g. USDC)"
            ],
            "type": "pubkey"
          },
          {
            "name": "outcome",
            "docs": [
              "Winning outcome (set after resolution)"
            ],
            "type": {
              "option": {
                "defined": {
                  "name": "outcome"
                }
              }
            }
          },
          {
            "name": "status",
            "docs": [
              "Market status"
            ],
            "type": {
              "defined": {
                "name": "marketStatus"
              }
            }
          },
          {
            "name": "createdAt",
            "docs": [
              "Creation timestamp"
            ],
            "type": "i64"
          },
          {
            "name": "resolvedAt",
            "docs": [
              "Resolution timestamp (if resolved)"
            ],
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "bump",
            "docs": [
              "Bump seed for this market PDA"
            ],
            "type": "u8"
          },
          {
            "name": "initialNavPerShare",
            "docs": [
              "NAV per share at market creation time for strategy A (oracle-free resolution)"
            ],
            "type": "u64"
          },
          {
            "name": "initialNavPerShareB",
            "docs": [
              "NAV per share at market creation time for strategy B (Relative markets only; 0 for Absolute)"
            ],
            "type": "u64"
          },
          {
            "name": "yesMintBump",
            "docs": [
              "Bump seeds for PDA accounts owned by this market"
            ],
            "type": "u8"
          },
          {
            "name": "noMintBump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "marketStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "resolved"
          }
        ]
      }
    },
    {
      "name": "marketType",
      "docs": [
        "Absolute: \"will strategy exceed X% APY?\"",
        "Relative: \"will strategy A outperform strategy B?\""
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "absolute"
          },
          {
            "name": "relative"
          }
        ]
      }
    },
    {
      "name": "outcome",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "yes"
          },
          {
            "name": "no"
          }
        ]
      }
    }
  ]
};
