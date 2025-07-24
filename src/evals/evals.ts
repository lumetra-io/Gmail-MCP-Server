//evals.ts - Enhanced evaluations including alias functionality

import { EvalConfig } from 'mcp-evals';
import { openai } from "@ai-sdk/openai";
import { grade, EvalFunction } from "mcp-evals";

const send_emailEval: EvalFunction = {
    name: "send_emailEval",
    description: "Evaluates sending a new email",
    run: async () => {
        const result = await grade(openai("gpt-4"), "Please send an email to example@domain.com with the subject 'Meeting Reminder' and a short message confirming our meeting tomorrow, politely requesting confirmation of attendance.");
        return JSON.parse(result);
    }
};

const send_email_with_aliasEval: EvalFunction = {
    name: "send_email_with_aliasEval",
    description: "Evaluates sending an email from a specific alias",
    run: async () => {
        const result = await grade(openai("gpt-4"), "Send an email to client@example.com from my work alias work@mycompany.com with the subject 'Project Update' and a professional message about project status.");
        return JSON.parse(result);
    }
};

const list_aliasesEval: EvalFunction = {
    name: "list_aliasesEval",
    description: "Evaluates listing send-as aliases",
    run: async () => {
        const result = await grade(openai("gpt-4"), "Please show me all my available send-as email aliases including their verification status.");
        return JSON.parse(result);
    }
};

const draft_email: EvalFunction = {
    name: 'draft_email',
    description: 'Evaluates the tool\'s ability to draft an email',
    run: async () => {
        const result = await grade(openai("gpt-4"), "Draft a new email to my manager requesting a meeting to discuss project updates and timelines.");
        return JSON.parse(result);
    }
};

const read_emailEval: EvalFunction = {
    name: 'read_email Tool Evaluation',
    description: 'Evaluates retrieving the content of a specific email',
    run: async () => {
        const result = await grade(openai("gpt-4"), "Please retrieve the content of the email with the subject 'Upcoming Meeting' from my inbox.");
        return JSON.parse(result);
    }
};

const search_emailsEval: EvalFunction = {
    name: "search_emails Tool Evaluation",
    description: "Evaluates the tool's ability to search emails using Gmail syntax",
    run: async () => {
        const result = await grade(openai("gpt-4"), "Search my mailbox for unread emails from boss@company.com that have attachments. Provide the Gmail search syntax.");
        return JSON.parse(result);
    }
};

const modify_emailEval: EvalFunction = {
    name: 'modify_email Tool Evaluation',
    description: 'Evaluates the modify_email tool functionality',
    run: async () => {
        const result = await grade(openai("gpt-4"), "Please move the email labeled 'Work' to the 'Important' folder and remove the 'unread' label.");
        return JSON.parse(result);
    }
};

const download_attachmentEval: EvalFunction = {
    name: 'download_attachment Tool Evaluation',
    description: 'Evaluates downloading email attachments',
    run: async () => {
        const result = await grade(openai("gpt-4"), "Download the PDF attachment from the email with subject 'Invoice #123' and save it to my Downloads folder.");
        return JSON.parse(result);
    }
};

const batch_operationsEval: EvalFunction = {
    name: 'batch_operations Tool Evaluation',
    description: 'Evaluates batch email operations',
    run: async () => {
        const result = await grade(openai("gpt-4"), "Mark all emails from newsletter@example.com as read and move them to the 'Newsletter' label in a single batch operation.");
        return JSON.parse(result);
    }
};

const label_managementEval: EvalFunction = {
    name: 'label_management Tool Evaluation',
    description: 'Evaluates Gmail label management functionality',
    run: async () => {
        const result = await grade(openai("gpt-4"), "Create a new Gmail label called 'Important Projects' and list all my current labels showing both system and user-defined labels.");
        return JSON.parse(result);
    }
};

const config: EvalConfig = {
    model: openai("gpt-4"),
    evals: [
        send_emailEval, 
        send_email_with_aliasEval,
        list_aliasesEval,
        draft_email, 
        read_emailEval, 
        search_emailsEval, 
        modify_emailEval,
        download_attachmentEval,
        batch_operationsEval,
        label_managementEval
    ]
};
  
export default config;
  
export const evals = [
    send_emailEval, 
    send_email_with_aliasEval,
    list_aliasesEval,
    draft_email, 
    read_emailEval, 
    search_emailsEval, 
    modify_emailEval,
    download_attachmentEval,
    batch_operationsEval,
    label_managementEval
];