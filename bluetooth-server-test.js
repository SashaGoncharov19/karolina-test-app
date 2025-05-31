const bleno = require('bleno');

// Define UUIDs for the service and characteristic
const SERVICE_UUID = '12345678-1234-1234-1234-123456789abc';
const CHARACTERISTIC_UUID = '87654321-4321-4321-4321-cba987654321';

// Log all events for debugging
console.log('Starting Bluetooth test server...');

// Handle Bluetooth state changes
bleno.on('stateChange', (state) => {
    console.log('Bluetooth state changed to:', state);

    if (state === 'poweredOn') {
        console.log('Bluetooth is powered on. Starting advertising...');
        bleno.startAdvertising('SmartSpeaker', [SERVICE_UUID], (error) => {
            if (error) console.error('Advertising error:', error);
            else console.log('Started advertising as "SmartSpeaker"');
        });
    } else {
        console.log('Stopping advertising due to Bluetooth state:', state);
        bleno.stopAdvertising();
    }
});

// Log advertising events
bleno.on('advertisingStart', (error) => {
    if (error) {
        console.error('Advertising start error:', error);
        return;
    }

    console.log('Advertising started successfully. Setting up services...');

    const characteristic = new bleno.Characteristic({
        uuid: CHARACTERISTIC_UUID,
        properties: ['write'],
        onWriteRequest: (data, offset, withoutResponse, callback) => {
            const receivedData = data.toString('utf8');
            console.log('Data received from mobile app:', receivedData);
            // Process the data (e.g., save settings for the smart speaker)
            callback(bleno.Characteristic.RESULT_SUCCESS);
        },
    });

    const service = new bleno.PrimaryService({
        uuid: SERVICE_UUID,
        characteristics: [characteristic],
    });

    bleno.setServices([service], (error) => {
        if (error) console.error('Set services error:', error);
        else console.log('Bluetooth service initialized successfully');
    });
});

// Log accept events
bleno.on('accept', (clientAddress) => {
    console.log(`Client connected: ${clientAddress}`);
});

// Log disconnect events
bleno.on('disconnect', (clientAddress) => {
    console.log(`Client disconnected: ${clientAddress}`);
});

// Keep the process running
console.log('Bluetooth server is running. Press Ctrl+C to exit.');

