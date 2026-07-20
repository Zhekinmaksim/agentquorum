export const escrowAbi = [
  {
    type: "function",
    name: "caseIdOf",
    inputs: [{ name: "caseKey", type: "bytes32", internalType: "bytes32" }],
    outputs: [{ name: "", type: "string", internalType: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "discoveryWorker",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "fundBond",
    inputs: [
      { name: "caseKey", type: "bytes32", internalType: "bytes32" },
      { name: "bondCt", type: "bytes", internalType: "bytes" },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "markReady",
    inputs: [{ name: "caseKey", type: "bytes32", internalType: "bytes32" }],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "openCase",
    inputs: [
      { name: "caseKey", type: "bytes32", internalType: "bytes32" },
      { name: "respondent", type: "address", internalType: "address" },
      { name: "caseId", type: "string", internalType: "string" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "phaseOf",
    inputs: [{ name: "caseKey", type: "bytes32", internalType: "bytes32" }],
    outputs: [{ name: "", type: "uint8", internalType: "enum ConfidentialEscrow.Phase" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "sealEvidenceKey",
    inputs: [
      { name: "caseKey", type: "bytes32", internalType: "bytes32" },
      { name: "keyCt", type: "bytes", internalType: "bytes" },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "tribunalRelayer",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
] as const;
