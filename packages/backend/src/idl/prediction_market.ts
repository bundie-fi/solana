/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/prediction_market.json`.
 */
export type PredictionMarket = {
  "address": "Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4",
  "metadata": {
    "name": "predictionMarket",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Bundie Prediction Market Program - LS-LMSR markets with oracle-free resolution"
  },
  "instructions": [
    {
      "name": "buyEventShares",
      "docs": [
        "Buy YES or NO shares in an event market (kinds 7/8/9). Mirrors",
        "`buy_shares` but signs with the `event_market` PDA seed prefix.",
        "`event_id_hash` is the sha256 of the canonical event_id slug from",
        "`scripts/resolvers/sources.json` — clients pass the same hash they",
        "used to derive the market PDA."
      ],
      "discriminator": [
        205,
        39,
        9,
        22,
        245,
        91,
        127,
        61
      ],
      "accounts": [
        {
          "name": "buyer",
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
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "eventIdHash"
              },
              {
                "kind": "account",
                "path": "market.market_id",
                "account": "market"
              }
            ]
          }
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
            "Buyer's USDC ATA — must hold enough to pay cost + fee."
          ],
          "writable": true
        },
        {
          "name": "buyerYesAta",
          "docs": [
            "Buyer's YES ATA — created on first buy if missing."
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
            "Buyer's NO ATA — created on first buy if missing."
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
          "name": "eventIdHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
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
      "name": "closeVault",
      "docs": [
        "Drain the vault treasury back to `owner_wallet`, close the",
        "treasury ATA, and close the BundieVault PDA (rent → owner).",
        "Only the `owner_wallet` recorded at init may call this."
      ],
      "discriminator": [
        141,
        103,
        17,
        126,
        72,
        75,
        29,
        29
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  110,
                  100,
                  105,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.authority",
                "account": "bundieVault"
              }
            ]
          }
        },
        {
          "name": "treasuryAta",
          "writable": true
        },
        {
          "name": "ownerAta",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "commitNav",
      "docs": [
        "Commit a new NAV value to the vault. Enforces strict monotonic",
        "epoch increment (`new_epoch == prev + 1`) so a stale or replayed",
        "commit cannot regress the vault. The `has_one = authority`",
        "constraint locks writes to the vault owner."
      ],
      "discriminator": [
        124,
        190,
        187,
        63,
        110,
        124,
        21,
        162
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  110,
                  100,
                  105,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newNav",
          "type": "u64"
        },
        {
          "name": "newEpoch",
          "type": "u64"
        },
        {
          "name": "commitDigest",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "createEvent",
      "docs": [
        "Open a parametric event market (kind 7/8/9) bound to an off-chain",
        "resolver authority. This is the primary market-creation entrypoint",
        "for the Bundie event venue. `create_market_v2` is retained as a",
        "legacy agent-NAV path used by zerion-agent.",
        "",
        "Event markets resolve from off-chain data sources (Pyth feeds,",
        "status pages, on-chain TVL accounts) via a signature from the",
        "resolver recorded in `ResolverAuthority`."
      ],
      "discriminator": [
        49,
        219,
        29,
        203,
        22,
        98,
        100,
        87
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
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "eventIdHash"
              },
              {
                "kind": "arg",
                "path": "marketId"
              }
            ]
          }
        },
        {
          "name": "resolverAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  115,
                  111,
                  108,
                  118,
                  101,
                  114,
                  95,
                  97,
                  117,
                  116,
                  104
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
          "name": "collateralMint"
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
          "name": "subsidySource",
          "docs": [
            "Creator's collateral ATA. The full `initial_subsidy` is transferred",
            "into `vault` at create time so the market opens with real backing."
          ],
          "writable": true
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
          "name": "eventIdHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "kind",
          "type": "u8"
        },
        {
          "name": "payload",
          "type": {
            "array": [
              "u8",
              64
            ]
          }
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
          "name": "resolver",
          "type": "pubkey"
        },
        {
          "name": "configHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
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
      "name": "createMarketV2",
      "docs": [
        "V2 — open a market of any of the five `MarketKind` variants. v1",
        "`create_market` continues to work and produces ApyThreshold-equivalent",
        "markets that resolve via the v1 `resolve` ix."
      ],
      "discriminator": [
        193,
        18,
        155,
        62,
        161,
        124,
        80,
        25
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
          "name": "strategyB",
          "docs": [
            "that do not need it (ApyThreshold, NavTarget, Drawdown, BackerCount)."
          ]
        },
        {
          "name": "collateralMint"
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
          "name": "subsidySource",
          "docs": [
            "Creator's collateral ATA. The full `initial_subsidy` is transferred",
            "from this account into the market `vault` at create time so the",
            "market is born with real backing liquidity (not just an LMSR",
            "liquidity_param). Mint must match `collateral_mint`; balance must",
            "cover `initial_subsidy`."
          ],
          "writable": true
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
        },
        {
          "name": "targetVaultA",
          "docs": [
            "Optional BundieVault for strategy A. Required for kinds 1/2/3",
            "(NavTarget, Relative, Drawdown) so create_market_v2 can snapshot",
            "the live NAV baseline. Pass `None` for legacy kinds (5/6) that",
            "do not yet flow through BundieVault."
          ],
          "optional": true
        },
        {
          "name": "targetVaultB",
          "docs": [
            "Optional BundieVault for strategy B. Required only for kind=2",
            "(RELATIVE / head-to-head). Pass `None` otherwise."
          ],
          "optional": true
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
          "name": "kind",
          "type": "u8"
        },
        {
          "name": "payload",
          "type": {
            "array": [
              "u8",
              64
            ]
          }
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
          "name": "initialNavA",
          "type": "u64"
        },
        {
          "name": "initialNavB",
          "type": "u64"
        }
      ]
    },
    {
      "name": "depositToVault",
      "docs": [
        "Transfer `amount` of the vault's treasury mint into its treasury",
        "ATA. Anyone may seed an agent."
      ],
      "discriminator": [
        18,
        62,
        110,
        8,
        26,
        106,
        248,
        151
      ],
      "accounts": [
        {
          "name": "depositor",
          "signer": true
        },
        {
          "name": "depositorAta",
          "writable": true
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  110,
                  100,
                  105,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.authority",
                "account": "bundieVault"
              }
            ]
          }
        },
        {
          "name": "treasuryAta",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initVault",
      "docs": [
        "Initialize a BundieVault PDA at epoch 0 with an initial NAV. The PDA",
        "is derived from `[\"bundie_vault\", authority]` so each authority owns",
        "exactly one vault. Phases B+ read NAV from this account during",
        "market resolution instead of CPIing into protocol-specific readers."
      ],
      "discriminator": [
        77,
        79,
        85,
        150,
        33,
        217,
        52,
        106
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  110,
                  100,
                  105,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "treasuryMint",
          "docs": [
            "Mint of the asset the treasury will hold (e.g. bUSD)."
          ]
        },
        {
          "name": "treasuryAta",
          "docs": [
            "Treasury ATA owned by the vault PDA itself. Created here so the",
            "vault can hold balance with no extra setup step."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
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
                "path": "treasuryMint"
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
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": [
        {
          "name": "initialNav",
          "type": "u64"
        },
        {
          "name": "ownerWallet",
          "type": "pubkey"
        },
        {
          "name": "treasuryMint",
          "type": "pubkey"
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
      "name": "redeemEvent",
      "docs": [
        "Redeem winning shares in a resolved event market for a pro-rata",
        "claim on the vault."
      ],
      "discriminator": [
        97,
        251,
        103,
        148,
        202,
        54,
        93,
        203
      ],
      "accounts": [
        {
          "name": "redeemer",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "eventIdHash"
              },
              {
                "kind": "account",
                "path": "market.market_id",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "winnerMint",
          "docs": [
            "The winning mint (caller passes the side that won)."
          ],
          "writable": true
        },
        {
          "name": "redeemerShares",
          "writable": true
        },
        {
          "name": "redeemerCollateral",
          "writable": true
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
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "eventIdHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
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
      "name": "resolveEvent",
      "docs": [
        "Settle an event market. The transaction must be signed by the",
        "pubkey recorded in the market's `ResolverAuthority` PDA. The",
        "resolver passes the outcome it observed off-chain; the on-chain",
        "logic only verifies the signer is the registered authority.",
        "",
        "Also freezes the CPI-readable `EventPrice` feed at the terminal",
        "outcome (0 for NO, PRICE_SCALE for YES) and flips its status to",
        "`STATUS_RESOLVED`. `event_id_hash` is passed explicitly so the",
        "EventPrice PDA can be derived without reading market payload."
      ],
      "discriminator": [
        184,
        55,
        78,
        47,
        114,
        38,
        50,
        90
      ],
      "accounts": [
        {
          "name": "resolver",
          "docs": [
            "Must match `resolver_authority.resolver` — checked via constraint."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "resolverAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  115,
                  111,
                  108,
                  118,
                  101,
                  114,
                  95,
                  97,
                  117,
                  116,
                  104
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
          "name": "eventPrice",
          "docs": [
            "CPI-readable price feed. `init_if_needed` so a market that",
            "resolves before `update_event_price` has ever been called still",
            "produces a terminal feed account for consumers to read.",
            "Keyed on `event_id_hash` to match the public PDA derivation."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  112,
                  114,
                  105,
                  99,
                  101
                ]
              },
              {
                "kind": "arg",
                "path": "eventIdHash"
              }
            ]
          }
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
          "name": "eventIdHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "resolveMarketV2",
      "docs": [
        "V2 — branch on `market.kind` and read the relevant on-chain quantity",
        "(NavOracle TWAP, Strategy.backer_count, ...) to set the outcome."
      ],
      "discriminator": [
        120,
        229,
        79,
        121,
        41,
        238,
        193,
        40
      ],
      "accounts": [
        {
          "name": "resolver",
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "dataA",
          "docs": [
            "Reserved data slot. Phase C resolution reads vault NAV directly;",
            "the legacy NavOracle / Strategy account paths are gone. Kept in the",
            "account list so existing client transaction layouts (which pass",
            "SystemProgram here as a placeholder) still serialise.",
            ""
          ]
        },
        {
          "name": "dataB",
          "docs": [
            "Reserved data slot — same rationale as `data_a`.",
            ""
          ]
        },
        {
          "name": "targetVaultA",
          "docs": [
            "Optional BundieVault for strategy A.",
            "Required for kinds 1 (NavTarget), 2 (Relative), and 3 (Drawdown) —",
            "the resolver reads `nav_lamports` to compute the outcome."
          ],
          "optional": true
        },
        {
          "name": "targetVaultB",
          "docs": [
            "Optional BundieVault for strategy B.",
            "Required only for kind=2 (RELATIVE / head-to-head)."
          ],
          "optional": true
        }
      ],
      "args": []
    },
    {
      "name": "sellEventShares",
      "docs": [
        "Sell YES or NO shares back to an event market."
      ],
      "discriminator": [
        137,
        168,
        108,
        109,
        165,
        108,
        7,
        232
      ],
      "accounts": [
        {
          "name": "seller",
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
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "eventIdHash"
              },
              {
                "kind": "account",
                "path": "market.market_id",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "outcomeMint",
          "docs": [
            "YES or NO mint (caller passes the side they're selling). Verified",
            "against the market's PDA seeds in the handler."
          ],
          "writable": true
        },
        {
          "name": "sellerShares",
          "writable": true
        },
        {
          "name": "sellerCollateral",
          "writable": true
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
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "eventIdHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
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
    },
    {
      "name": "updateEventPrice",
      "docs": [
        "Tick the CPI-readable price feed for an event market. Called",
        "each resolver loop with the latest LMSR mid-price + confidence +",
        "depth. First call creates the `EventPrice` PDA; subsequent calls",
        "bump fields. Same auth model as `resolve_event` (resolver signer",
        "+ config_hash gating).",
        "",
        "Consumers (external Solana programs) derive the PDA from",
        "`[b\"event_price\", event_id_hash]` and read the account directly —",
        "no CPI back into this program required."
      ],
      "discriminator": [
        74,
        70,
        209,
        160,
        146,
        164,
        111,
        146
      ],
      "accounts": [
        {
          "name": "resolver",
          "docs": [
            "Must match `resolver_authority.resolver` — checked via constraint."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "market"
        },
        {
          "name": "resolverAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  115,
                  111,
                  108,
                  118,
                  101,
                  114,
                  95,
                  97,
                  117,
                  116,
                  104
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
          "name": "eventPrice",
          "docs": [
            "CPI-readable price feed. Created on first call, mutated on",
            "subsequent ticks. Keyed on `event_id_hash` (not market.key()) so",
            "foreign programs can derive the PDA from just the event slug."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  112,
                  114,
                  105,
                  99,
                  101
                ]
              },
              {
                "kind": "arg",
                "path": "eventIdHash"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "eventIdHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "configHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "price",
          "type": "u64"
        },
        {
          "name": "confidence",
          "type": "u64"
        },
        {
          "name": "depthUsd",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "bundieVault",
      "discriminator": [
        239,
        32,
        103,
        186,
        197,
        8,
        108,
        152
      ]
    },
    {
      "name": "eventPrice",
      "discriminator": [
        54,
        55,
        53,
        50,
        48,
        218,
        164,
        147
      ]
    },
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
    },
    {
      "name": "resolverAuthority",
      "discriminator": [
        74,
        73,
        254,
        104,
        250,
        219,
        64,
        134
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
    },
    {
      "code": 6014,
      "name": "invalidKind",
      "msg": "Unknown market kind discriminator"
    },
    {
      "code": 6015,
      "name": "invalidPayload",
      "msg": "Per-kind payload failed validation (zero/oversized/missing field)"
    },
    {
      "code": 6016,
      "name": "resolveDeferredKind",
      "msg": "This market kind is not yet implemented (Drawdown awaits NavOracle history extension)"
    },
    {
      "code": 6017,
      "name": "insiderMarketForbidden",
      "msg": "Agent cannot create a kind=6 market on its own strategy (insider-trading forbidden)"
    },
    {
      "code": 6018,
      "name": "wrongTargetAgent",
      "msg": "resolve_market_v2 data_a does not match the target_agent encoded in market payload"
    },
    {
      "code": 6019,
      "name": "staleNavEpoch",
      "msg": "Vault NAV epoch must increment monotonically"
    },
    {
      "code": 6020,
      "name": "unauthorizedVaultCommit",
      "msg": "Caller is not the vault authority"
    },
    {
      "code": 6021,
      "name": "missingTargetVault",
      "msg": "Required target vault account not provided"
    },
    {
      "code": 6022,
      "name": "wrongTargetVault",
      "msg": "Provided target vault does not match the authority pinned at create-time (PDA mismatch)"
    },
    {
      "code": 6023,
      "name": "deprecatedMarketKind",
      "msg": "Market kind is deprecated — use kinds 1 (NAV target), 2 (head-to-head), or 3 (drawdown)"
    },
    {
      "code": 6024,
      "name": "unauthorizedVaultClose",
      "msg": "Caller is not the vault owner_wallet — cannot close"
    },
    {
      "code": 6025,
      "name": "resolverMismatch",
      "msg": "Resolver signer does not match the registered ResolverAuthority pubkey"
    },
    {
      "code": 6026,
      "name": "wrongResolverMarket",
      "msg": "ResolverAuthority PDA's market field does not match the supplied market account"
    },
    {
      "code": 6027,
      "name": "invalidResolver",
      "msg": "Invalid resolver pubkey (default Pubkey not allowed)"
    }
  ],
  "types": [
    {
      "name": "bundieVault",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "ownerWallet",
            "docs": [
              "Wallet that funded / owns the agent. Authorized to call",
              "`close_vault` and reclaim treasury balance."
            ],
            "type": "pubkey"
          },
          {
            "name": "treasuryMint",
            "docs": [
              "SPL mint of the treasury asset (e.g. bUSD)."
            ],
            "type": "pubkey"
          },
          {
            "name": "treasuryAta",
            "docs": [
              "Associated token account owned by this vault PDA that holds",
              "`treasury_mint` balance. Created during `init_vault`."
            ],
            "type": "pubkey"
          },
          {
            "name": "navLamports",
            "type": "u64"
          },
          {
            "name": "navEpoch",
            "type": "u64"
          },
          {
            "name": "navSlot",
            "type": "u64"
          },
          {
            "name": "commitDigest",
            "docs": [
              "Opaque off-chain audit commitment (e.g. hash of the agent's",
              "computation log for this epoch). The program does not verify or",
              "interpret this value; it is recorded verbatim for off-chain audit."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "eventPrice",
      "docs": [
        "CPI-readable price feed for a single event market.",
        "",
        "Layout is intentionally flat + fixed-size: every consumer can parse",
        "it with a single `borsh::from_slice(&data[8..])` after the Anchor",
        "discriminator. No `Option`s, no `Vec`s, no `String`s — the field",
        "order is the wire format and is part of Bundie's published ABI."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "eventIdHash",
            "docs": [
              "blake3 hash of the canonical event_id slug from",
              "`scripts/resolvers/sources.json`. Same hash used as the market",
              "PDA seed; consumers verify the price feed matches the event",
              "they expect."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "market",
            "docs": [
              "The Market account this price tracks. Defence-in-depth — a",
              "consumer that already has the market pubkey can cross-check."
            ],
            "type": "pubkey"
          },
          {
            "name": "price",
            "docs": [
              "YES-share probability in Q9 fixed-point (exponent = -9).",
              "Range: [0, PRICE_SCALE]. After resolution this is frozen at",
              "either 0 (NO won) or PRICE_SCALE (YES won)."
            ],
            "type": "u64"
          },
          {
            "name": "exponent",
            "docs": [
              "Fixed-point exponent for `price` and `confidence`. Always",
              "`EVENT_PRICE_EXPONENT` for v1, but stored explicitly so",
              "consumers can parse without hardcoding the scale."
            ],
            "type": "i32"
          },
          {
            "name": "confidence",
            "docs": [
              "Confidence interval (Q9). Smaller = higher confidence.",
              "Computed off-chain from LMSR depth + spread; see",
              "`packages/backend/src/v1/lmsr.ts::confidenceScore`."
            ],
            "type": "u64"
          },
          {
            "name": "depthUsdU64",
            "docs": [
              "Market depth in USDC base units (6 decimals). NOT Q9-scaled —",
              "matches the collateral mint's native units. Consumers use this",
              "to weight the price (thin markets ⇒ low trust)."
            ],
            "type": "u64"
          },
          {
            "name": "updatedAtSlot",
            "docs": [
              "Solana slot of the last `update_event_price` call. Consumers",
              "reject feeds older than their staleness threshold."
            ],
            "type": "u64"
          },
          {
            "name": "updatedAtTs",
            "docs": [
              "`Clock::unix_timestamp` of the last update. Mirrors",
              "`updated_at_slot` in wall-clock domain for off-chain consumers."
            ],
            "type": "i64"
          },
          {
            "name": "status",
            "docs": [
              "`STATUS_ACTIVE` (0) while the market is live; `STATUS_RESOLVED`",
              "(1) once `resolve_event` has settled. Once resolved, `price` is",
              "frozen and consumers can treat it as a terminal value."
            ],
            "type": "u8"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump."
            ],
            "type": "u8"
          },
          {
            "name": "reserved",
            "docs": [
              "Reserved for forward-compatible additions (TWAP, decimals,",
              "confidence_lo/hi, ...). Zero-initialised; consumers ignore."
            ],
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
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
            "name": "initialNavA",
            "docs": [
              "BundieVault NAV (lamports) snapshotted at create_market_v2 for vault A.",
              "Phase B uses this as the baseline for kinds 1/2/3 (NavTarget/Relative/Drawdown)",
              "when resolving against `BundieVault.nav_lamports`. Zero for kinds that",
              "do not snapshot a vault baseline."
            ],
            "type": "u64"
          },
          {
            "name": "initialNavB",
            "docs": [
              "BundieVault NAV (lamports) snapshotted at create_market_v2 for vault B.",
              "Only populated for kind=2 (RELATIVE / head-to-head). Zero otherwise."
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
          },
          {
            "name": "kind",
            "docs": [
              "V2 market kind discriminator. See `MARKET_KIND_*` constants.",
              "V1 markets created via `create_market` are written with kind=0",
              "(ApyThreshold) for compatibility, but their resolution still flows",
              "through the original `resolve` ix (which only branches on",
              "`market_type`). v2 markets created via `create_market_v2` set this",
              "field explicitly and resolve via `resolve_market_v2`."
            ],
            "type": "u8"
          },
          {
            "name": "payload",
            "docs": [
              "Per-kind config payload. Layout documented on `MarketKind`. Fixed",
              "size so the Market account never grows; v1 markets carry zeroes."
            ],
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "createdBy",
            "docs": [
              "Identity that signed `create_market_v2` — for Bundie agent markets",
              "this is the Zerion-managed agent vault pubkey (the `creator` signer",
              "in the v2 ix context). For `MARKET_KIND_AGENT_VS_BENCHMARK` this",
              "pubkey IS the agent's vault under measurement (no extra field).",
              "",
              "For v1 markets created via `create_market`, this mirrors `authority`",
              "so every Market account has a populated `created_by` — clients can",
              "read it uniformly without branching on kind."
            ],
            "type": "pubkey"
          },
          {
            "name": "targetAuthorityA",
            "docs": [
              "Authority of the BundieVault snapshotted as `target_vault_a` at",
              "create-time. Pinned here so resolve_market_v2 can re-derive the same",
              "PDA (`[\"bundie_vault\", target_authority_a]`) and reject any",
              "caller-substituted vault. `None` for kinds that do not snapshot",
              "vault A."
            ],
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "targetAuthorityB",
            "docs": [
              "Authority of the BundieVault snapshotted as `target_vault_b` at",
              "create-time. Only populated for kind=2 (RELATIVE / head-to-head).",
              "`None` otherwise."
            ],
            "type": {
              "option": "pubkey"
            }
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
        "V1 market type. Kept for back-compat with existing markets created via",
        "the original `create_market` ix.",
        "- Absolute: \"will strategy exceed X% APY?\"",
        "- Relative: \"will strategy A outperform strategy B?\""
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
    },
    {
      "name": "resolverAuthority",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "resolver",
            "docs": [
              "The pubkey allowed to sign `resolve_event` for this market.",
              "Set at create-time via `create_event`; immutable thereafter",
              "(v1 ships no rotation ix — that lands when the dispute layer does)."
            ],
            "type": "pubkey"
          },
          {
            "name": "configHash",
            "docs": [
              "blake3 hash of the resolver's `scripts/resolvers/sources.json` entry.",
              "Off-chain resolvers verify this before signing — if it doesn't match",
              "their loaded config, they refuse to resolve."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "market",
            "docs": [
              "The market this resolver is bound to. Defence-in-depth — a stale",
              "PDA passed by a malicious client is rejected on key mismatch."
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump."
            ],
            "type": "u8"
          }
        ]
      }
    }
  ]
};
