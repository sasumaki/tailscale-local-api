import { TailscaleLocalApi } from './index.js'

async function main() {
    try {
        // Initialize the API
        const api = new TailscaleLocalApi({
            useSocketOnly: true
        })
      
        // await api.pushFile('neV1oKjEhd11CNTRL', "/Users/sasu/code/tailscale-local-api/tonni.png")
    

        const test = await api.startLoginInteractive()
        console.log(test)

    } catch (error) {
        console.error('Test failed:', error)
    }
}

main()