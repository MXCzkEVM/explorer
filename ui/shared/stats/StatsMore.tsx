/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable react/jsx-no-bind */
/* eslint-disable no-restricted-imports */
/* eslint-disable max-len */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { ApolloClient, HttpLink, InMemoryCache } from '@apollo/client';
import { Link } from '@chakra-ui/react';
import { cover, loop, pipe } from '@hairy/utils';
import { moonchain, moonchainGeneva } from '@moonchain/metadata';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import gql from 'graphql-tag';
import { useEffect } from 'react';
import { createPublicClient, getContract, http } from 'viem';
import { arbitrum, arbitrumSepolia } from 'viem/chains';

import config from 'configs/app';
import { Hint } from 'toolkit/components/Hint/Hint';
import StatsWidget from 'ui/shared/stats/StatsWidget';

import { fragments } from './StatsMore.fragments';

const queries = {
  burn: gql`
    {
        bundle(id: 1) {
            burn
        }
        mxcdayDatas(first: 1000) {
            id
            date
            burn
        }
    }
  `,
};

const configs = {
  testnet: {
    graph: 'https://geneva-graph-node.mxc.com/subgraphs/name/mxczkevm/mxc-graph',
    clients: {
      moonchain: createPublicClient({ chain: moonchainGeneva, transport: http() }),
      arbitrum: createPublicClient({ chain: arbitrumSepolia, transport: http() }),
    },
    addresses: {
      l1: { arbitrum: '0x6a5c9E342d5FB5f5EF8a799f0cAAB2678C939b0B' },
      l2: { moonchain: '0x1000777700000000000000000000000000000001' },
    },
  },
  mainnet: {
    graph: 'https://graph-node.mxc.com/subgraphs/name/mxczkevm/mxc-graph',
    clients: {
      moonchain: createPublicClient({ chain: moonchain, transport: http() }),
      arbitrum: createPublicClient({ chain: arbitrum, transport: http() }),
    },
    addresses: {
      l1: { arbitrum: '0x54D8864e8855A7B66eE42B8F2Eaa0F2E06bd641a' },
      l2: { moonchain: '0x1000777700000000000000000000000000000001' },
    },
  },
} as const;

const getOptions = {
  mainnet: () => ({
    graph: new ApolloClient({
      link: new HttpLink({ uri: configs.mainnet.graph }),
      cache: new InMemoryCache(),
    }),
    clients: configs.mainnet.clients,
    addresses: configs.mainnet.addresses,
    contracts: {
      l1: getContract({
        abi: fragments.l1,
        address: configs.mainnet.addresses.l1.arbitrum,
        client: configs.mainnet.clients.arbitrum,
      }),
      l2: getContract({
        abi: fragments.l2,
        address: configs.mainnet.addresses.l2.moonchain,
        client: configs.mainnet.clients.moonchain,
      }),
    },
    chains: {
      arbitrum: arbitrum,
      moonchain: moonchain,
    },
  }),
  testnet: () => ({
    graph: new ApolloClient({
      link: new HttpLink({ uri: configs.testnet.graph }),
      cache: new InMemoryCache(),
    }),
    clients: configs.testnet.clients,
    addresses: configs.testnet.addresses,
    contracts: {
      l1: getContract({
        abi: fragments.l1,
        address: configs.testnet.addresses.l1.arbitrum,
        client: configs.testnet.clients.arbitrum,
      }),
      l2: getContract({
        abi: fragments.l2,
        address: configs.testnet.addresses.l2.moonchain,
        client: configs.testnet.clients.moonchain,
      }),
    },
    chains: {
      arbitrum: arbitrumSepolia,
      moonchain: moonchainGeneva,
    },
  }),
} as const;

const { contracts, graph, clients, chains } = config.chain.id === '5167004' ?
  getOptions.testnet() :
  getOptions.mainnet();

function StatsMoreViem({ icon = true }: { icon?: boolean } = {}) {
  const l2latestSyncedHeader = useQuery({
    queryKey: [ 'statsMore_l2latestSyncedHeader' ],
    queryFn: async() => {
      const [ _, blockHash ] = await contracts.l1.read.getLastSyncedBlock();
      return blockHash;
    },
  });
  const l1latestSyncedHeader = useQuery({
    queryKey: [ 'statsMore_l1latestSyncedHeader' ],
    queryFn: async() => {
      // 获取 moonchain lastSyncedBlock
      const lastSyncedBlock = await contracts.l2.read.lastSyncedBlock();
      // 获取 arbitrum 对应的 blockHash
      const block = await clients.arbitrum.getBlock({ blockNumber: lastSyncedBlock });
      return block.hash;
    },
  });
  const lastVerifiedBlock = useQuery({
    queryKey: [ 'statsMore_lastVerifiedBlock' ],
    queryFn: async() => {
      const [ blockId ] = await contracts.l1.read.getLastVerifiedBlock();
      return blockId;
    },
  });
  const unverifiedBlocks = useQuery({
    queryKey: [ 'statsMore_unverifiedBlocks' ],
    queryFn: async() => {
      const [ lastVerifiedBlock ] = await contracts.l1.read.getLastVerifiedBlock();
      const lastBlock = await clients.moonchain.getBlockNumber();
      return lastBlock - lastVerifiedBlock;
    },
  });
  const availableSlots = useQuery({
    queryKey: [ 'statsMore_availableSlots' ],
    queryFn: async() => {
      const [ lastVerifiedBlock ] = await contracts.l1.read.getLastVerifiedBlock();
      const lastBlock = await clients.moonchain.getBlockNumber();
      const config = await contracts.l1.read.getConfig();
      return config.blockRingBufferSize - (lastBlock - lastVerifiedBlock) % config.blockRingBufferSize;
    },
  });
  const latestProofTime = useQuery({
    queryKey: [ 'statsMore_latestProofTime' ],
    queryFn: async() => {
      const [ lastVerifiedBlock ] = await contracts.l1.read.getLastVerifiedBlock();
      const { verifiedTransitionId } = await contracts.l1.read.getBlockV2([ lastVerifiedBlock ]);
      const transition = await contracts.l1.read.getTransition([ lastVerifiedBlock, verifiedTransitionId ]) as any;
      return transition.timestamp;
    },
  });
  const burnsTotal = useQuery({
    queryKey: [ 'statsMore_burnsTotal' ],
    queryFn: pipe.promise(
      () => graph.query({ query: queries.burn }),
      result => result?.data?.bundle.burn || 0,
      burns => parseInt(burns),
    ),
  });

  useEffect(
    () => {
      const cancel = loop(async(next) => {
        await next(20000); // 20s
        l2latestSyncedHeader.refetch();
        l1latestSyncedHeader.refetch();
        lastVerifiedBlock.refetch();
        unverifiedBlocks.refetch();
        availableSlots.refetch();
        latestProofTime.refetch();
        burnsTotal.refetch();
      });
      return () => cancel();
    },
    [],
  );

  return (
    <>
      <StatsWidget
        icon={ icon ? 'burger' : undefined }
        label="L1 Latest Synced Header"
        value={ (
          <Link
            onClick={ () => {
              const explorer = chains.arbitrum.blockExplorers.default;
              window.open(`${ explorer.url }/block/${ l1latestSyncedHeader.data }`, '_blank');
            } }
          >
            { cover(l1latestSyncedHeader.data || '', [ 4, 4, 4 ]) }
          </Link>
        ) }
        isLoading={ l1latestSyncedHeader.isLoading }
        hint={ <Hint label="The most recent Layer 2 Header that has been synchronized with the MXCL1 smart contract."/> }
      />
      <StatsWidget
        icon={ icon ? 'burger' : undefined }
        label="L2 Latest Synced Header"
        value={ (
          <Link
            onClick={ () => {
              const explorer = chains.moonchain.blockExplorers.default;
              window.open(`${ explorer.url }/block/${ l2latestSyncedHeader.data }`, '_blank');
            } }
          >
            { cover(l2latestSyncedHeader.data || '', [ 4, 4, 4 ]) }
          </Link>
        ) }
        isLoading={ l2latestSyncedHeader.isLoading }
        hint={ <Hint label="The most recent Layer 1 Header that has been synchronized with the MXCL2 smart contract. The headers are synchronized with every L2 block."/> }
      />
      <StatsWidget
        icon={ icon ? 'block' : undefined }
        label="Last Verified Block"
        value={ lastVerifiedBlock.data?.toString() }
        isLoading={ lastVerifiedBlock.isLoading }
        hint={ <Hint label="The latest block that has been verified."/> }
      />
      <StatsWidget
        icon={ icon ? 'block' : undefined }
        label="Unverified Blocks"
        value={ unverifiedBlocks.data?.toString() }
        isLoading={ unverifiedBlocks.isLoading }
        hint={ <Hint label="The number of blocks that have not been verified yet."/> }
      />
      <StatsWidget
        icon={ icon ? 'burger' : undefined }
        label="Available Slots"
        value={ availableSlots.data?.toString() }
        isLoading={ availableSlots.isLoading }
        hint={ <Hint label="The amount of slots for proposed blocks on the MXCL1 smart contract. When this number is 0, no blocks can be proposed until a block has been proven."/> }
      />
      <StatsWidget
        icon={ icon ? 'flame' : undefined }
        label="Total Burnt MXC"
        value={ burnsTotal.data }
        isLoading={ burnsTotal.isLoading }
        hint={ <Hint label="The total amount of burns."/> }
      />
      <StatsWidget
        icon={ icon ? 'ABI' : undefined }
        label="Latest Proof Time"
        value={ latestProofTime.data ? dayjs.unix(Number(latestProofTime.data)).format('YYYY-MM-DD HH:mm:ss') : '' }
        isLoading={ latestProofTime.isLoading }
        hint={ <Hint label="The time of the latest proof."/> }
      />
    </>
  );
}

export default StatsMoreViem;
