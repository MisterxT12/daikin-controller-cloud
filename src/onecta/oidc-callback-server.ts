
import type { IncomingMessage, ServerResponse } from 'node:http';

import { resolve, join } from 'node:path';
import { createServer, Server } from 'node:https';
import { readFile } from 'node:fs/promises';
import { OnectaClientConfig, onecta_oidc_auth_thank_you_html } from './oidc-utils.js';

export type OnectaOIDCCallbackServerRequestListener<
    Request extends typeof IncomingMessage = typeof IncomingMessage,
    Response extends typeof ServerResponse = typeof ServerResponse,
> = (server: Server, req: InstanceType<Request>, res: InstanceType<Response> & { req: InstanceType<Request> }) => void;

/**
 * Creates and starts a HTTPS server
 */
export const startOnectaOIDCCallbackServer = async (config: OnectaClientConfig, oidc_state: string, auth_url: string): Promise<string> => {
    const certificatePath = config.certificate_path ?? resolve(__dirname, '..', '..', 'cert');
    const server = createServer({
        key: await readFile(join(certificatePath, 'cert.key')),
        cert: await readFile(join(certificatePath, 'cert.pem')),
    });
    await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
            server.removeListener('listening', onListening);
            server.removeListener('error', onError);
        };
        const onListening = () => {
            cleanup();
            resolve();
        }
        const onError = (err: Error) => {
            cleanup();
            reject(err);
        };
        server.on('listening', onListening);
        server.on('error', onError);
        server.listen(config.oidc_callback_server_port, config.oidc_callback_server_addr);
    });
    return await new Promise<string>((resolve, reject) => {
        let timeout: NodeJS.Timeout;
        const cleanup = () => {
            clearTimeout(timeout);
            server.removeListener('request', onRequest);
            server.removeListener('error', onError);
            server.close();
            server.closeAllConnections();
        };
        const onError = (err: Error) => {
            cleanup();
            reject(err);
        };
        const onTimeout = () => {
            cleanup();
            reject(new Error('Authorization time out'));
        };
        const onAuthCode = (code: string) => {
            cleanup();
            resolve(code);
        };
        const onRequest = (req: IncomingMessage, res: ServerResponse) => {
            const url = new URL(req.url ?? '/', config.oidc_callback_server_baseurl);
            const res_state = url.searchParams.get('state');
            const auth_code = url.searchParams.get('code');
            if (res_state === oidc_state && auth_code) {
                res.statusCode = 200;
                res.write(config.onecta_oidc_auth_thank_you_html ?? onecta_oidc_auth_thank_you_html);
                res.once('finish', () => onAuthCode(auth_code));
            } else if (req.url ?? '/' === '/') {
                //Redirect to auth_url
                res.writeHead(302, {
                    'Location': auth_url,
                });
            }
            else {
                res.statusCode = 400;
            }
            res.end();
        };
        setTimeout(onTimeout, config.oidc_authorization_timeout * 1000);
        server.on('request', onRequest);
        server.on('error', onError);
    });
};
