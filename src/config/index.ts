export interface ScannerConfig {
  solanaEndpoints: {
    rpc: string;
    websocket: string;
  };
  dexEndpoints: {
    [key: string]: {
      rest: string;
      websocket?: string;
    };
  };
  scanning: {
    updateInterval: number;
    minProfitThreshold: number;
    maxSlippage: number;
    commitment: 'processed' | 'confirmed' | 'finalized';
  };
  pools: {
    [dex: string]: string[];
  };
}

export const DEFAULT_CONFIG: ScannerConfig = {
  solanaEndpoints: {
    rpc: 'https://api.mainnet-beta.solana.com',
    websocket: 'wss://api.mainnet-beta.solana.com'
  },
  dexEndpoints: {
    Raydium: {
      rest: 'https://api.raydium.io/v2',
      websocket: 'wss://api.raydium.io/v2/ws'
    },
    Orca: {
      rest: 'https://api.orca.so/v1',
      websocket: 'wss://api.orca.so/v1/ws'
    },
    Phoenix: {
      rest: 'https://phoenix-api.solana.com/v1'
    },
    Jupiter: {
      rest: 'https://quote-api.jup.ag/v6'
    }
  },
  scanning: {
    updateInterval: 1000, // 1 second
    minProfitThreshold: 0.1, // 0.1%
    maxSlippage: 2.0, // 2%
    commitment: 'confirmed'
  },
  pools: {
    Raydium: [
      '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2', // SOL/USDC
      '7qhGhsVMdLMGaIzGPZEFwFZHNTRF1J1QyG9V3tpKQE3Z', // SOL/USDT
      '8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj'  // RAY/USDC
    ],
    Orca: [
      'EGZ7tiLeH62TPV1gL8WwbXGzEPa9zmcpVnnkPKKnrE2U', // SOL/USDC Whirlpool
      '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP', // SOL/USDT Whirlpool
      'H8Zs9rYbfKo5gqDGNpHLZCmhBDf3v7K8jPSz9K3mG8nW'  // ORCA/USDC Whirlpool
    ]
  }
}; 