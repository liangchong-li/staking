// deploy-config.js
module.exports = {
    hardhat: {
        rewardToken: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512", // 本地测试时可以先部署一个mock代币
        startBlockOffset: 100, // 相对当前区块的偏移
        durationBlocks: 100000, // 持续区块数
        rewardPerBlock: ethers.parseEther("1"), // 每个区块奖励
    },
    localhost: {
        rewardToken: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512", // 本地测试时可以先部署一个mock代币
        startBlockOffset: 100, // 相对当前区块的偏移
        durationBlocks: 100000, // 持续区块数
        rewardPerBlock: ethers.parseEther("1"), // 每个区块奖励
    },
    sepolia: {
        rewardToken: "0x...", // Sepolia网络上的实际代币地址
        startBlockOffset: 100,
        durationBlocks: 100000,
        rewardPerBlock: ethers.parseEther("1"),
    },
    mainnet: {
        rewardToken: "0x...", // 主网上的实际代币地址
        startBlockOffset: 100,
        durationBlocks: 100000,
        rewardPerBlock: ethers.parseEther("1"),
    }
};

// 辅助函数：获取网络配置
function getConfig(networkName) {
    const config = require("./deploy-config.js");
    const networkConfig = config[networkName] || {};

    // 合并配置，网络特定配置覆盖默认配置
    return networkConfig;
}

module.exports.getConfig = getConfig;