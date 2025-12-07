// deploy/01_deploy_reward_token.js
const { ethers } = require("hardhat");

module.exports = async ({ getNamedAccounts, deployments }) => {
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    console.log("部署奖励代币...");

    // 部署一个测试用的ERC20代币
    const RewardToken = await ethers.getContractFactory("ERC20Mock");
    const rewardToken = await RewardToken.deploy(
        "Stake Reward Token",
        "SRT",
        deployer,
        ethers.parseEther("1000000") // 发行100万个代币
    );

    await rewardToken.waitForDeployment();

    const address = await rewardToken.getAddress();
    console.log("奖励代币地址:", address);

    return address;
};

module.exports.tags = ['deployRewardToken'];