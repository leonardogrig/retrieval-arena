import supabase from "@/lib/supabase";
import { SupabaseVectorStore } from "@langchain/community/vectorstores/supabase";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { ContextualCompressionRetriever } from "langchain/retrievers/contextual_compression";
import { LLMChainExtractor } from "langchain/retrievers/document_compressors/chain_extract";
import { MultiQueryRetriever } from "langchain/retrievers/multi_query";
import { MultiVectorRetriever } from "langchain/retrievers/multi_vector";
import { ParentDocumentRetriever } from "langchain/retrievers/parent_document";
import { ScoreThresholdRetriever } from "langchain/retrievers/score_threshold";
import { SelfQueryRetriever } from "langchain/retrievers/self_query";
import { SupabaseTranslator } from "langchain/retrievers/self_query/supabase";
import { TimeWeightedVectorStoreRetriever } from "langchain/retrievers/time_weighted";
import { InMemoryStore } from "langchain/storage/in_memory";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { attributeInfo } from "./variables";
import { CustomRetriever } from "@/lib/types";

export function ContextualCompression(
    model: ChatOpenAI,
    vectorstore: SupabaseVectorStore | MemoryVectorStore,
) {
    const baseCompressor = LLMChainExtractor.fromLLM(model);

    return new ContextualCompressionRetriever({
        baseCompressor,
        baseRetriever: vectorstore.asRetriever(),

    })
}

export function MultiQuery(
    model: ChatOpenAI,
    vectorstore: SupabaseVectorStore | MemoryVectorStore,
) {

    return MultiQueryRetriever.fromLLM({
        llm: model,
        retriever: vectorstore.asRetriever(),
        verbose: false,

    });
}

export async function ParentDocument(
    vectorstore: SupabaseVectorStore | MemoryVectorStore,
    currentMessageContent: string,
) {

    const temporaryVectorStore = new MemoryVectorStore(new OpenAIEmbeddings());
    const docstore = new InMemoryStore();

    const retriever = new ParentDocumentRetriever({
        vectorstore: temporaryVectorStore,
        docstore,

        parentSplitter: new RecursiveCharacterTextSplitter({
            chunkOverlap: 0,
            chunkSize: 500,
        }),
        childSplitter: new RecursiveCharacterTextSplitter({
            chunkOverlap: 0,
            chunkSize: 50,
        }),

        childK: 20,

        parentK: 5,
    });

    const vstoreRetriever = vectorstore.asRetriever();

    const parentDocuments = await vstoreRetriever.getRelevantDocuments(
        currentMessageContent,
    );

    await retriever.addDocuments(parentDocuments);

    return retriever;

}

export async function SelfQuery(
    model: ChatOpenAI,
    vectorstore: SupabaseVectorStore | MemoryVectorStore,
    currentMessageContent: string,
) {

    const vstoreRetriever = vectorstore.asRetriever();
    const embeddings = new OpenAIEmbeddings();
    const documents = await vstoreRetriever.getRelevantDocuments(
        currentMessageContent,
    );

    const vectorStore2 = await SupabaseVectorStore.fromDocuments(documents, embeddings, {
        client: supabase,
    });

    const selfQueryRetriever = await SelfQueryRetriever.fromLLM({
        llm: model,
        vectorStore: vectorStore2,
        documentContents: currentMessageContent,
        attributeInfo,
        structuredQueryTranslator: new SupabaseTranslator(),
    });

    return selfQueryRetriever
}

export function SimilarityScore(
    vectorstore: SupabaseVectorStore | MemoryVectorStore,
) {

    return ScoreThresholdRetriever.fromVectorStore(vectorstore, {
        minSimilarityScore: 0,
        maxK: 5,
        kIncrement: 2,

    });
}

export async function TimeWeighted(
    vectorstore: SupabaseVectorStore | MemoryVectorStore,
    currentMessageContent: string,
) {
    const vectorstore2 = new MemoryVectorStore(new OpenAIEmbeddings());

    const retriever = new TimeWeightedVectorStoreRetriever({
        vectorStore: vectorstore2,
        memoryStream: [],
        searchKwargs: 2,
    });

    const vstoreRetriever = vectorstore.asRetriever();

    const documents = await vstoreRetriever.getRelevantDocuments(
        currentMessageContent,
    );


    await retriever.addDocuments(documents);

    return retriever
}

export function VectorStore(
    vectorstore: SupabaseVectorStore | MemoryVectorStore
) {

    return vectorstore.asRetriever();
}

export function MultiVector(
    vectorstore: SupabaseVectorStore | MemoryVectorStore,
) {
    const byteStore = new InMemoryStore<Uint8Array>();

    return new MultiVectorRetriever({
        vectorstore,
        byteStore,

    });

}

export async function baseRequest({
    query,
    id
}: {
    query: string,
    id: string,
}) {
    return fetch(`${process.env.PYTHON_MICRO_SERVER}/api/query`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: query, id: id}),
    });
}

export async function GraphRAGLI({
    query,
    retrieverId
}:{
    query: string, // what is pg?
    retrieverId: string, // graph-rag-li 
}) {

    const serverResponse = await fetch(`${process.env.PYTHON_MICRO_SERVER}/api/python-retrievers/${retrieverId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: query }),
    });

    const data = await serverResponse.json();

    if (!serverResponse.ok) {
        throw new Error(`Error fetching server: ${data.message}`);
    }

    console.log('data', data)

    const documents = data.documents.map((doc:any) => ({
        pageContent: doc.content,
        metadata: doc.metadata ?? null
    }));

    return new CustomRetriever(true,documents);
}