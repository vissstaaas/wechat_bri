import { isLoggedIn } from "weixin-agent-sdk";

process.exit(isLoggedIn() ? 0 : 42);
