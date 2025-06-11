export { BaseDexClient, DexPoolInfo, DexPriceQuote } from '../BaseDexClient';
export { RaydiumClient } from './RaydiumClient';
export { OrcaClient } from './OrcaClient';
export { PhoenixClient } from './PhoenixClient';
export { MeteoraClient } from './MeteoraClient';

import { RaydiumClient } from './RaydiumClient';
import { OrcaClient } from './OrcaClient';
import { PhoenixClient } from './PhoenixClient';
import { MeteoraClient } from './MeteoraClient';
import { BaseDexClient, DexPoolInfo, DexPriceQuote } from '../BaseDexClient';

// DEX Client factory
export class DexClientFactory {
  static createRaydiumClient(rpcUrl?: string): RaydiumClient {
    return new RaydiumClient(rpcUrl);
  }

  static createOrcaClient(rpcUrl?: string): OrcaClient {
    return new OrcaClient(rpcUrl);
  }

  static createPhoenixClient(rpcUrl?: string): PhoenixClient {
    return new PhoenixClient(rpcUrl);
  }

  static createMeteoraClient(rpcUrl?: string): MeteoraClient {
    return new MeteoraClient(rpcUrl);
  }

  static createAllClients(rpcUrl?: string): {
    raydium: RaydiumClient;
    orca: OrcaClient;
    phoenix: PhoenixClient;
    meteora: MeteoraClient;
  } {
    return {
      raydium: new RaydiumClient(rpcUrl),
      orca: new OrcaClient(rpcUrl),
      phoenix: new PhoenixClient(rpcUrl),
      meteora: new MeteoraClient(rpcUrl)
    };
  }
}

// DEX Client Manager
export class DexClientManager {
  private clients: Map<string, BaseDexClient> = new Map();

  constructor(rpcUrl?: string) {
    this.clients.set('raydium', new RaydiumClient(rpcUrl));
    this.clients.set('orca', new OrcaClient(rpcUrl));
    this.clients.set('phoenix', new PhoenixClient(rpcUrl));
    this.clients.set('meteora', new MeteoraClient(rpcUrl));
  }

  async connectAll(): Promise<void> {
    const connectionPromises = Array.from(this.clients.values()).map(client => 
      client.connect().catch(error => {
        console.error(`Failed to connect ${client.getDexName()}:`, error);
        return null;
      })
    );
    
    await Promise.all(connectionPromises);
  }

  async disconnectAll(): Promise<void> {
    const disconnectionPromises = Array.from(this.clients.values()).map(client => 
      client.disconnect().catch(error => {
        console.error(`Failed to disconnect ${client.getDexName()}:`, error);
        return null;
      })
    );
    
    await Promise.all(disconnectionPromises);
  }

  getClient(dexName: string): BaseDexClient | undefined {
    return this.clients.get(dexName.toLowerCase());
  }

  getAllClients(): BaseDexClient[] {
    return Array.from(this.clients.values());
  }

  getConnectedClients(): BaseDexClient[] {
    return Array.from(this.clients.values()).filter(client => client.isClientConnected());
  }

  async getAllPoolsFromAllDexes(): Promise<{ dex: string; pools: DexPoolInfo[] }[]> {
    const results = await Promise.all(
      Array.from(this.clients.entries()).map(async ([dexName, client]) => {
        try {
          if (!client.isClientConnected()) {
            await client.connect();
          }
          const pools = await client.getAllPools();
          return { dex: dexName, pools };
        } catch (error) {
          console.error(`Failed to get pools from ${dexName}:`, error);
          return { dex: dexName, pools: [] };
        }
      })
    );

    return results;
  }

  async getPriceQuotesFromAllDexes(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<{ dex: string; quote: DexPriceQuote | null }[]> {
    const results = await Promise.all(
      Array.from(this.clients.entries()).map(async ([dexName, client]) => {
        try {
          if (!client.isClientConnected()) {
            await client.connect();
          }
          const quote = await client.getPriceQuote(inputMint, outputMint, amount);
          return { dex: dexName, quote };
        } catch (error) {
          console.error(`Failed to get quote from ${dexName}:`, error);
          return { dex: dexName, quote: null };
        }
      })
    );

    return results;
  }
} 