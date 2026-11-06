/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/leash.json`.
 */
export type Leash = {
  "address": "Cck8fpFodqfGqKXk1UkhVbYoDXMEqk3vAshB4e3G5SAe",
  "metadata": {
    "name": "leash",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Onchain mandates for AI agent wallets: owner-signed payees, mandates and co-signs, enforced by the program"
  },
  "instructions": [
    {
      "name": "addPayee",
      "discriminator": [
        248,
        28,
        137,
        95,
        9,
        128,
        223,
        82
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault"
        },
        {
          "name": "payeeAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  121,
                  101,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "arg",
                "path": "payee"
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
          "name": "payee",
          "type": "pubkey"
        },
        {
          "name": "label",
          "type": "string"
        },
        {
          "name": "perTxMax",
          "type": "u64"
        },
        {
          "name": "budgetTotal",
          "type": "u64"
        }
      ]
    },
    {
      "name": "agentSpend",
      "docs": [
        "Strict path: any policy violation reverts with a named error (the red failed tx in the explorer)."
      ],
      "discriminator": [
        23,
        170,
        137,
        159,
        219,
        53,
        9,
        61
      ],
      "accounts": [
        {
          "name": "agent",
          "signer": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "mint"
        },
        {
          "name": "vaultAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
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
          "name": "recipientAta",
          "docs": [
            "recipient yields a named Leash error, and so guarded_spend can record it instead of reverting."
          ],
          "writable": true
        },
        {
          "name": "payeeAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "mandateAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "reasonHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "memo",
          "type": {
            "option": {
              "array": [
                "u8",
                32
              ]
            }
          }
        }
      ]
    },
    {
      "name": "approveRequest",
      "docs": [
        "The owner's co-signature: re-checks the policy (except the threshold) and pays."
      ],
      "discriminator": [
        89,
        68,
        167,
        104,
        93,
        25,
        178,
        205
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "request"
          ]
        },
        {
          "name": "request",
          "writable": true
        },
        {
          "name": "mint"
        },
        {
          "name": "vaultAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
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
          "name": "recipientAta",
          "writable": true
        },
        {
          "name": "payeeAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "mandateAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "createMandate",
      "discriminator": [
        230,
        170,
        158,
        68,
        33,
        169,
        16,
        158
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "mandate",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  100,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "vault.mandateSeq",
                "account": "vault"
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
          "name": "payee",
          "type": "pubkey"
        },
        {
          "name": "maxTotal",
          "type": "u64"
        },
        {
          "name": "maxPerTx",
          "type": "u64"
        },
        {
          "name": "expiresAt",
          "type": "i64"
        },
        {
          "name": "intentHash",
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
      "name": "guardedSpend",
      "docs": [
        "Tripwire path: a policy violation does NOT revert. It records a strike, emits PaymentBlocked, and may",
        "auto-pause the vault, so the refusal is counted onchain where anyone can verify it."
      ],
      "discriminator": [
        75,
        222,
        100,
        149,
        214,
        92,
        123,
        57
      ],
      "accounts": [
        {
          "name": "agent",
          "signer": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "mint"
        },
        {
          "name": "vaultAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
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
          "name": "recipientAta",
          "docs": [
            "recipient yields a named Leash error, and so guarded_spend can record it instead of reverting."
          ],
          "writable": true
        },
        {
          "name": "payeeAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "mandateAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "reasonHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "memo",
          "type": {
            "option": {
              "array": [
                "u8",
                32
              ]
            }
          }
        }
      ]
    },
    {
      "name": "initializeVault",
      "discriminator": [
        48,
        191,
        163,
        44,
        71,
        129,
        63,
        164
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
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "arg",
                "path": "vaultId"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "vaultAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
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
          "name": "tokenProgram"
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
          "name": "vaultId",
          "type": "u64"
        },
        {
          "name": "agent",
          "type": "pubkey"
        },
        {
          "name": "policy",
          "type": {
            "defined": {
              "name": "policy"
            }
          }
        }
      ]
    },
    {
      "name": "redeemSignedMandate",
      "docs": [
        "The owner signed `terms` off-chain (wallet signMessage, no SOL, no tx); the agent redeems it here.",
        "The tx must be `[Ed25519 precompile ix, redeem_signed_mandate]`."
      ],
      "discriminator": [
        12,
        75,
        143,
        222,
        214,
        86,
        215,
        217
      ],
      "accounts": [
        {
          "name": "agent",
          "docs": [
            "The agent submits (and pays for) the owner's signed mandate."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "mandate",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  100,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "vault.mandateSeq",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "terms",
          "type": {
            "defined": {
              "name": "mandateTerms"
            }
          }
        }
      ]
    },
    {
      "name": "rejectRequest",
      "discriminator": [
        11,
        232,
        75,
        149,
        197,
        137,
        152,
        208
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "relations": [
            "request"
          ]
        },
        {
          "name": "request",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "removePayee",
      "discriminator": [
        107,
        214,
        166,
        252,
        91,
        122,
        83,
        219
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "relations": [
            "payeeAccount"
          ]
        },
        {
          "name": "payeeAccount",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "requestSpend",
      "docs": [
        "Ask the owner to co-sign a payment (typically one at or above the co-sign threshold)."
      ],
      "discriminator": [
        127,
        12,
        23,
        75,
        137,
        178,
        148,
        71
      ],
      "accounts": [
        {
          "name": "agent",
          "docs": [
            "The agent pays the request account's rent."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "request",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  113,
                  117,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "vault.requestSeq",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "payeeAccount",
          "optional": true
        },
        {
          "name": "mandateAccount",
          "optional": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "payee",
          "type": "pubkey"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "reasonHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "memo",
          "type": {
            "option": {
              "array": [
                "u8",
                32
              ]
            }
          }
        }
      ]
    },
    {
      "name": "resetStrikes",
      "discriminator": [
        229,
        230,
        157,
        213,
        19,
        117,
        31,
        13
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "revokeMandate",
      "discriminator": [
        252,
        97,
        140,
        119,
        67,
        43,
        177,
        108
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "relations": [
            "mandate"
          ]
        },
        {
          "name": "mandate",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "setAgent",
      "discriminator": [
        154,
        74,
        121,
        91,
        137,
        19,
        101,
        166
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "newAgent",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "setPaused",
      "docs": [
        "Kill switch. Unpausing also clears tripwire strikes (the owner has looked at what happened)."
      ],
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "updatePayee",
      "discriminator": [
        194,
        47,
        172,
        2,
        192,
        16,
        104,
        65
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "relations": [
            "payeeAccount"
          ]
        },
        {
          "name": "payeeAccount",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "perTxMax",
          "type": "u64"
        },
        {
          "name": "budgetTotal",
          "type": "u64"
        },
        {
          "name": "active",
          "type": "bool"
        }
      ]
    },
    {
      "name": "updatePolicy",
      "discriminator": [
        212,
        245,
        246,
        7,
        163,
        151,
        18,
        57
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "policy",
          "type": {
            "defined": {
              "name": "policy"
            }
          }
        }
      ]
    },
    {
      "name": "withdraw",
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault"
        },
        {
          "name": "mint"
        },
        {
          "name": "vaultAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
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
          "name": "ownerTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "mandate",
      "discriminator": [
        113,
        216,
        98,
        159,
        185,
        63,
        55,
        18
      ]
    },
    {
      "name": "payee",
      "discriminator": [
        55,
        185,
        7,
        92,
        94,
        200,
        10,
        246
      ]
    },
    {
      "name": "spendRequest",
      "discriminator": [
        71,
        251,
        215,
        71,
        98,
        153,
        90,
        25
      ]
    },
    {
      "name": "vault",
      "discriminator": [
        211,
        8,
        232,
        43,
        2,
        152,
        117,
        119
      ]
    }
  ],
  "events": [
    {
      "name": "mandateCreated",
      "discriminator": [
        140,
        30,
        209,
        254,
        5,
        128,
        147,
        113
      ]
    },
    {
      "name": "mandateRevoked",
      "discriminator": [
        228,
        111,
        181,
        60,
        204,
        58,
        131,
        28
      ]
    },
    {
      "name": "payeeChanged",
      "discriminator": [
        226,
        239,
        218,
        4,
        227,
        219,
        131,
        166
      ]
    },
    {
      "name": "paymentBlocked",
      "discriminator": [
        120,
        202,
        107,
        44,
        217,
        7,
        30,
        50
      ]
    },
    {
      "name": "policyUpdated",
      "discriminator": [
        225,
        112,
        112,
        67,
        95,
        236,
        245,
        161
      ]
    },
    {
      "name": "requestResolved",
      "discriminator": [
        37,
        213,
        58,
        157,
        34,
        111,
        158,
        162
      ]
    },
    {
      "name": "spendExecuted",
      "discriminator": [
        27,
        251,
        149,
        186,
        175,
        148,
        73,
        5
      ]
    },
    {
      "name": "spendRequested",
      "discriminator": [
        144,
        207,
        254,
        247,
        81,
        146,
        84,
        87
      ]
    },
    {
      "name": "vaultFrozen",
      "discriminator": [
        13,
        199,
        172,
        111,
        88,
        10,
        151,
        247
      ]
    },
    {
      "name": "vaultPausedChanged",
      "discriminator": [
        139,
        116,
        12,
        73,
        70,
        15,
        250,
        111
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "notAgent",
      "msg": "Signer is not this vault's agent"
    },
    {
      "code": 6001,
      "name": "vaultPaused",
      "msg": "Vault is paused by its owner"
    },
    {
      "code": 6002,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6003,
      "name": "recipientMismatch",
      "msg": "Recipient token account does not match the authorized payee or mint"
    },
    {
      "code": 6004,
      "name": "payeeNotAuthorized",
      "msg": "Payee is not on the owner's allowlist and no mandate covers it"
    },
    {
      "code": 6005,
      "name": "exceedsPayeePerTx",
      "msg": "Amount exceeds this payee's per-transaction maximum"
    },
    {
      "code": 6006,
      "name": "payeeBudgetExceeded",
      "msg": "This payee's budget is used up"
    },
    {
      "code": 6007,
      "name": "mandateExpired",
      "msg": "Mandate has expired"
    },
    {
      "code": 6008,
      "name": "mandateRevoked",
      "msg": "Mandate was revoked by the owner"
    },
    {
      "code": 6009,
      "name": "mandateExhausted",
      "msg": "Mandate amount is used up"
    },
    {
      "code": 6010,
      "name": "exceedsPerTxCap",
      "msg": "Amount exceeds the vault's per-transaction cap"
    },
    {
      "code": 6011,
      "name": "exceedsDailyCap",
      "msg": "Amount exceeds the vault's 24h cap"
    },
    {
      "code": 6012,
      "name": "requiresCosign",
      "msg": "Amount needs owner co-signature; submit a spend request"
    },
    {
      "code": 6013,
      "name": "requestNotPending",
      "msg": "Spend request is not pending"
    },
    {
      "code": 6014,
      "name": "requestExpired",
      "msg": "Spend request has expired"
    },
    {
      "code": 6015,
      "name": "invalidMandateSignature",
      "msg": "Mandate signature is missing or invalid"
    },
    {
      "code": 6016,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6017,
      "name": "notOwner",
      "msg": "Only the vault owner can do this"
    },
    {
      "code": 6018,
      "name": "invalidPolicy",
      "msg": "Invalid policy: caps must be positive and the 24h cap at least the per-tx cap"
    },
    {
      "code": 6019,
      "name": "labelTooLong",
      "msg": "Payee label is longer than 32 bytes"
    },
    {
      "code": 6020,
      "name": "insufficientFunds",
      "msg": "Vault balance is too low for this payment"
    },
    {
      "code": 6021,
      "name": "invalidMandateTerms",
      "msg": "Invalid mandate terms: limits must be positive and expiry in the future"
    }
  ],
  "types": [
    {
      "name": "authKind",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "payee"
          },
          {
            "name": "mandate"
          },
          {
            "name": "request"
          }
        ]
      }
    },
    {
      "name": "mandate",
      "docs": [
        "Owner-signed intent for a payee that is not on the allowlist."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "payee",
            "type": "pubkey"
          },
          {
            "name": "maxTotal",
            "type": "u64"
          },
          {
            "name": "maxPerTx",
            "type": "u64"
          },
          {
            "name": "spent",
            "type": "u64"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          },
          {
            "name": "intentHash",
            "docs": [
              "sha256 of the human-readable intent text (shown in the dashboard)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "revoked",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "mandateCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "mandate",
            "type": "pubkey"
          },
          {
            "name": "payee",
            "type": "pubkey"
          },
          {
            "name": "maxTotal",
            "type": "u64"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          },
          {
            "name": "intentHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "signedOffchain",
            "docs": [
              "true when created from an off-chain owner signature (redeem_signed_mandate)"
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "mandateRevoked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "mandate",
            "type": "pubkey"
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "mandateTerms",
      "docs": [
        "Terms the owner signs off-chain for `redeem_signed_mandate`.",
        "`nonce` must equal `vault.mandate_seq`, which makes every signature single-use."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "payee",
            "type": "pubkey"
          },
          {
            "name": "maxTotal",
            "type": "u64"
          },
          {
            "name": "maxPerTx",
            "type": "u64"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          },
          {
            "name": "intentHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "nonce",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "payee",
      "docs": [
        "An owner-approved payee with its own budget (e.g. one x402 service)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "payee",
            "docs": [
              "Wallet that receives; payments go to its token account for the vault mint."
            ],
            "type": "pubkey"
          },
          {
            "name": "label",
            "type": "string"
          },
          {
            "name": "perTxMax",
            "type": "u64"
          },
          {
            "name": "budgetTotal",
            "docs": [
              "Lifetime budget for this payee. 0 = unlimited within the vault caps."
            ],
            "type": "u64"
          },
          {
            "name": "spent",
            "type": "u64"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "payeeChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "payee",
            "type": "pubkey"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "removed",
            "type": "bool"
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "paymentBlocked",
      "docs": [
        "guarded_spend refused a payment without reverting: the strike is now onchain."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "attemptedPayee",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "reasonCode",
            "docs": [
              "Leash error number (e.g. 6004 = PayeeNotAuthorized)"
            ],
            "type": "u16"
          },
          {
            "name": "reasonHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "blockedCount",
            "type": "u64"
          },
          {
            "name": "strikes",
            "type": "u8"
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "policy",
      "docs": [
        "Vault policy, set at init and by `update_policy`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "perTxCap",
            "type": "u64"
          },
          {
            "name": "dailyCap",
            "type": "u64"
          },
          {
            "name": "cosignThreshold",
            "type": "u64"
          },
          {
            "name": "requestTtlSecs",
            "type": "i64"
          },
          {
            "name": "freezeAfterStrikes",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "policyUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "requestResolved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "request",
            "type": "pubkey"
          },
          {
            "name": "approved",
            "type": "bool"
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "requestStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "pending"
          },
          {
            "name": "approved"
          },
          {
            "name": "rejected"
          },
          {
            "name": "expired"
          }
        ]
      }
    },
    {
      "name": "spendExecuted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "payee",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "reasonHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "memo",
            "type": {
              "option": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          },
          {
            "name": "via",
            "type": {
              "defined": {
                "name": "authKind"
              }
            }
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "spendRequest",
      "docs": [
        "A payment over the co-sign threshold, waiting for the owner (approved via a Blink)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "payee",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "reasonHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "requestStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "memo",
            "docs": [
              "x402 payment nonce carried through to the SpendExecuted event when the owner approves."
            ],
            "type": {
              "option": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          }
        ]
      }
    },
    {
      "name": "spendRequested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "request",
            "type": "pubkey"
          },
          {
            "name": "payee",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "reasonHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "vault",
      "docs": [
        "The agent's funds, and every rule that governs them."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "docs": [
              "Human owner: the root of trust. Only this key changes policy or approves."
            ],
            "type": "pubkey"
          },
          {
            "name": "agent",
            "docs": [
              "Agent signing key: may *request* payments, never authorize them. Holds only fee SOL."
            ],
            "type": "pubkey"
          },
          {
            "name": "mint",
            "docs": [
              "One mint per vault (dUSDC on devnet)."
            ],
            "type": "pubkey"
          },
          {
            "name": "vaultId",
            "type": "u64"
          },
          {
            "name": "paused",
            "docs": [
              "Kill switch."
            ],
            "type": "bool"
          },
          {
            "name": "perTxCap",
            "type": "u64"
          },
          {
            "name": "dailyCap",
            "docs": [
              "Rolling 24h cap."
            ],
            "type": "u64"
          },
          {
            "name": "windowStart",
            "type": "i64"
          },
          {
            "name": "spentInWindow",
            "type": "u64"
          },
          {
            "name": "cosignThreshold",
            "docs": [
              "amount >= this needs an owner co-sign (spend request). 0 = disabled."
            ],
            "type": "u64"
          },
          {
            "name": "requestTtlSecs",
            "type": "i64"
          },
          {
            "name": "requestSeq",
            "type": "u64"
          },
          {
            "name": "mandateSeq",
            "type": "u64"
          },
          {
            "name": "totalSpent",
            "type": "u64"
          },
          {
            "name": "blockedCount",
            "docs": [
              "Tripwire (guarded_spend): counts every refused attempt, readable by anyone."
            ],
            "type": "u64"
          },
          {
            "name": "strikes",
            "type": "u8"
          },
          {
            "name": "freezeAfterStrikes",
            "docs": [
              "Auto-pause after this many strikes. 0 = never."
            ],
            "type": "u8"
          },
          {
            "name": "lastBlockedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "vaultFrozen",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "strikes",
            "type": "u8"
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "vaultPausedChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    }
  ]
};
