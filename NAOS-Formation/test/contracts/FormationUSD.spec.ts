import chai from "chai";
import chaiSubset from "chai-subset";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";
import { BigNumber, BigNumberish, ContractFactory, Signer, utils } from "ethers";
import { Transmuter } from "../../types/Transmuter";
import { Formation } from "../../types/Formation";
import { StakingPools } from "../../types/StakingPools";
import { NToken } from "../../types/NToken";
import { Erc20Mock } from "../../types/Erc20Mock";
import { MAXIMUM_U256, ZERO_ADDRESS, DEFAULT_FLUSH_ACTIVATOR } from "../utils/helpers";
import { VaultAdapterMock } from "../../types/VaultAdapterMock";
import { YearnVaultAdapter } from "../../types/YearnVaultAdapter";
import { YearnVaultMock } from "../../types/YearnVaultMock";
import { YearnControllerMock } from "../../types/YearnControllerMock";
import { min } from "moment";
const {parseEther, formatEther} = utils;

chai.use(solidity);
chai.use(chaiSubset);

const { expect } = chai;

let FormationFactory: ContractFactory;
let NUSDFactory: ContractFactory;
let ERC20MockFactory: ContractFactory;
let VaultAdapterMockFactory: ContractFactory;
let TransmuterFactory: ContractFactory;
let YearnVaultAdapterFactory: ContractFactory;
let YearnVaultMockFactory: ContractFactory;
let YearnControllerMockFactory: ContractFactory;

describe("Formation", () => {
  let signers: Signer[];

  before(async () => {
    FormationFactory = await ethers.getContractFactory("Formation");
    TransmuterFactory = await ethers.getContractFactory("Transmuter");
    NUSDFactory = await ethers.getContractFactory("NToken");
    ERC20MockFactory = await ethers.getContractFactory("ERC20Mock");
    VaultAdapterMockFactory = await ethers.getContractFactory(
      "VaultAdapterMock"
    );
    YearnVaultAdapterFactory = await ethers.getContractFactory("YearnVaultAdapter");
    YearnVaultMockFactory = await ethers.getContractFactory("YearnVaultMock");
    YearnControllerMockFactory = await ethers.getContractFactory("YearnControllerMock");
  });

  beforeEach(async () => {
    signers = await ethers.getSigners();
  });

  describe("vault actions", () => {
    let deployer: Signer;
    let governance: Signer;
    let sentinel: Signer;
    let rewards: Signer;
    let transmuter: Signer;
    let minter: Signer;
    let user: Signer;
    let token: Erc20Mock;
    let nUsd: NToken;
    let formation: Formation;
    let adapter: VaultAdapterMock;
    let newAdapter: VaultAdapterMock;
    let harvestFee = 1000;
    let pctReso = 10000;
    let transmuterContract: Transmuter;

    beforeEach(async () => {
      [
        deployer,
        governance,
        sentinel,
        rewards,
        transmuter,
        minter,
        user,
        ...signers
      ] = signers;

      token = (await ERC20MockFactory.connect(deployer).deploy(
        "Mock DAI",
        "DAI",
        18
      )) as Erc20Mock;

      nUsd = (await NUSDFactory.connect(deployer).deploy()) as NToken;

      formation = (await FormationFactory.connect(deployer).deploy(
        token.address,
        nUsd.address,
        await governance.getAddress(),
        await sentinel.getAddress(),
        DEFAULT_FLUSH_ACTIVATOR
      )) as Formation;

      await formation
        .connect(governance)
        .setTransmuter(await transmuter.getAddress());
      await formation
        .connect(governance)
        .setRewards(await rewards.getAddress());
      await formation.connect(governance).setHarvestFee(harvestFee);
      transmuterContract = (await TransmuterFactory.connect(deployer).deploy(
        nUsd.address,
        token.address,
        await governance.getAddress()
      )) as Transmuter;
      await formation.connect(governance).setTransmuter(transmuterContract.address);
      await transmuterContract.connect(governance).setWhitelist(formation.address, true);
      await token.mint(await minter.getAddress(), parseEther("10000"));
      await token.connect(minter).approve(formation.address, parseEther("10000"));
    });


    describe("recall funds", () => {
      context("from the active vault", () => {
        let adapter: YearnVaultAdapter;
        let controllerMock: YearnControllerMock;
        let vaultMock: YearnVaultMock;
        let depositAmt = parseEther("5000");
        let mintAmt = parseEther("1000");
        let recallAmt = parseEther("500");

        beforeEach(async () => {
          controllerMock = await YearnControllerMockFactory
            .connect(deployer)
            .deploy() as YearnControllerMock;
          vaultMock = await YearnVaultMockFactory
            .connect(deployer)
            .deploy(token.address, controllerMock.address) as YearnVaultMock;
          adapter = await YearnVaultAdapterFactory
            .connect(deployer)
            .deploy(vaultMock.address, formation.address) as YearnVaultAdapter;
          await token.mint(await deployer.getAddress(), parseEther("10000"));
          await token.approve(vaultMock.address, parseEther("10000"));
          await formation.connect(governance).initialize(adapter.address)
          await formation.connect(minter).deposit(depositAmt);
          await formation.flush();
          // need at least one other deposit in the vault to not get underflow errors
          await vaultMock.connect(deployer).deposit(parseEther("100"));
        });

        it("governance can recall some of the funds", async () => {//err1
          let beforeBal = await token.connect(governance).balanceOf(formation.address);
          await formation.connect(governance).recall(0, recallAmt);
          let afterBal = await token.connect(governance).balanceOf(formation.address);
          expect(beforeBal).equal(0);
          expect(afterBal).equal(recallAmt);
        });

        it("governance can recall all of the funds", async () => {//err2
          await formation.connect(governance).recallAll(0);
          expect(await token.connect(governance).balanceOf(formation.address)).equal(depositAmt);
        });

        describe("in an emergency", async () => {
          it("anyone can recall funds", async () => {//err3
            await formation.connect(governance).setEmergencyExit(true);
            await formation.connect(minter).recallAll(0);
            expect(await token.connect(governance).balanceOf(formation.address)).equal(depositAmt);
          });

          it("after some usage", async () => {//err4
            await formation.connect(minter).deposit(mintAmt);
            await formation.connect(governance).flush();
            await token.mint(adapter.address, parseEther("500"));
            await formation.connect(governance).setEmergencyExit(true);
            await formation.connect(minter).recallAll(0);
            expect(await token.connect(governance).balanceOf(formation.address)).equal(depositAmt.add(mintAmt));
          });
        })
      });

    });


  });
});
