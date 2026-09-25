import webpush from 'web-push';
const k = webpush.generateVAPIDKeys();
console.log('# add these to .env (generate ONCE; rotating keys invalidates existing subscriptions)');
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${k.privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com');
