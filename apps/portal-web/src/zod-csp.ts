import {z} from 'zod';

// Strict CSP reports Zod's caught eval probe as a securitypolicyviolation.
z.config({jitless:true});
