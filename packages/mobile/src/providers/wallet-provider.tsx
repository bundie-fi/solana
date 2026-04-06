import { ReactNode, createContext, useContext, useState, useCallback } from "react";
import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { PublicKey } from "@solana/web3.js";

interface WalletContextType {
  publicKey: PublicKey | null;
  connected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextType>({
  publicKey: null,
  connected: false,
  connect: async () => {},
  disconnect: () => {},
});

export function WalletProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);

  const connect = useCallback(async () => {
    try {
      await transact(async (wallet) => {
        const authResult = await wallet.authorize({
          identity: {
            name: "Yields.so",
            uri: "https://yields.so",
            icon: "favicon.ico",
          },
          cluster: "devnet",
        });
        setPublicKey(new PublicKey(authResult.accounts[0].address));
      });
    } catch (error) {
      console.error("Wallet connection failed:", error);
    }
  }, []);

  const disconnect = useCallback(() => {
    setPublicKey(null);
  }, []);

  return (
    <WalletContext.Provider
      value={{ publicKey, connected: !!publicKey, connect, disconnect }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export const useWallet = () => useContext(WalletContext);
