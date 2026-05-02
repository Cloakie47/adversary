// Wagmi config using Tempo's built-in tempoWallet connector (Path 1).
import { createConfig, http } from 'wagmi';
import { defineChain } from 'viem';
import { tempoWallet } from 'wagmi/tempo';

export const tempoModerato = defineChain({
  id: 42431,
  name: 'Tempo Moderato',
  nativeCurrency: { name: 'pathUSD', symbol: 'pUSD', decimals: 6 },
  rpcUrls: {
    default: { http: ['https://rpc.moderato.tempo.xyz'] },
    public:  { http: ['https://rpc.moderato.tempo.xyz'] },
  },
  blockExplorers: {
    default: {
      name: 'Tempo Moderato Explorer',
      url: 'https://explore.moderato.tempo.xyz',
    },
  },
  testnet: true,
});

export const wagmiConfig = createConfig({
  chains: [tempoModerato],
  connectors: [tempoWallet()],
  multiInjectedProviderDiscovery: false,
  transports: {
    [tempoModerato.id]: http(),
  },
});